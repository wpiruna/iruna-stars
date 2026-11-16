/**
 * Positional attack training (F2): builds the drill from the squads, feeds it the controller
 * each fixed step and turns its events into picture, sound, vibration and HUD.
 */
import type { Renderer } from 'pixi.js';
import type { Sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import type { GameData } from '../data/load';
import type { Team } from '../data/model';
import type { Controller } from '../input/controller';
import type { SaveStore } from '../persist/storage';
import { BEHIND_GOAL } from '../render/pool';
import { PlayView } from '../render/playview';
import { TILT, type Camera } from '../render/camera';
import type { Goal } from '../sim/field';
import type { QualityProfile } from '../render/quality';
import { AttackDrill } from '../sim/attack/drill';
import { pickLineup } from '../sim/attack/formation';
import type { AttackEvent, AttackResult, Slot } from '../sim/attack/types';
import { pickKeeper } from '../sim/duel/shootout';
import { fieldFromRules } from '../sim/field';
import { emptyHud, hud, type AttackScenario, type BannerTone } from '../ui/hud';
import { swimActivity } from './ambience';
import { vibrate } from './platform';
import type { Session } from './session';

export const SCENARIO_SLOTS: Record<Exclude<AttackScenario, 'contra2x1' | 'contra3x2' | 'superioridad' | 'inferioridad'>, Slot[]> = {
  completo: ['boya', 'extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre'],
  // No centre: the middle is open for drives.
  entradas: ['extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre'],
  boya: ['boya', 'lateralIzq', 'lateralDer', 'cierre'],
};

const RESULT_BANNER: Record<AttackResult, { text: string; tone: BannerTone; detail?: string }> = {
  goal: { text: '¡GOL!', tone: 'great' },
  save: { text: '¡PARADA!', tone: 'bad' },
  miss: { text: '¡FUERA!', tone: 'bad' },
  steal: { text: '¡ROBO!', tone: 'bad', detail: 'Mucho tiempo con el balón y el defensor encima' },
  intercept: { text: '¡INTERCEPTADO!', tone: 'bad' },
  clock: { text: '¡POSESIÓN!', tone: 'bad', detail: 'Se acabaron los segundos' },
  loose: { text: 'BALÓN PERDIDO', tone: 'bad' },
};

export interface AttackDeps {
  renderer: Renderer;
  data: GameData;
  save: SaveStore;
  controller: Controller;
  sfx: Sfx;
}

export class AttackSession implements Session {
  readonly view;
  readonly seed: number;
  timeScale = 1;
  readonly drill: AttackDrill;
  private readonly attackView: PlayView;
  private freeze = 0;
  private slowSeconds = 0;
  private bannerId = 0;
  private pauseHeld = false;
  private lastClock = -1;
  private lastShotKmh = 0;

  constructor(
    private readonly deps: AttackDeps,
    readonly rival: Team,
    readonly scenario: Exclude<AttackScenario, 'contra2x1' | 'contra3x2' | 'superioridad' | 'inferioridad'>,
  ) {
    const { data } = deps;
    this.seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    const rng = new Rng(this.seed);
    const field = fieldFromRules(data.rules);
    const slots = SCENARIO_SLOTS[scenario];
    this.drill = new AttackDrill({
      field,
      formations: data.formations,
      lineup: pickLineup(data.ourTeam.players, slots),
      marking: pickLineup(rival.players, slots),
      keeper: pickKeeper(rival),
      defenseStyle: rival.style === 'defensive' ? 'zone' : 'press',
      possession: {
        first: data.rules.posesion.primera,
        second: data.rules.posesion.segunda,
        clockSpeed: data.rules.velocidadRelojes.posesion,
      },
      tuning: data.tuning.ataque,
      shot: data.tuning.tiro,
      keeperTuning: data.tuning.portero,
      tilt: TILT,
      rng: rng.fork('drill'),
    });
    this.attackView = new PlayView(
      deps.renderer,
      field,
      this.drill,
      data.tuning.tiro,
      data.tuning.ataque.pase,
      rng.fork('view'),
      {
        hitStop: (frames) => (this.freeze = Math.max(this.freeze, frames)),
        slowMotion: (scale, seconds) => {
          this.timeScale = scale;
          this.slowSeconds = seconds;
        },
      },
      (camera, snap) => frameAttack(camera, this.drill.goal, this.drill.ball.pos.y, snap),
    );
    this.view = this.attackView.view;
    // Thursday training: the water, but nobody in the stands.
    deps.sfx.startAmbience({ crowd: false });
    hud.set({
      ...emptyHud(),
      mode: 'attack',
      attack: {
        scenario,
        clock: Math.ceil(this.drill.clock),
        attacks: this.drill.stats.attacks,
        goals: 0,
        shots: 0,
        turnovers: 0,
        ours: { id: data.ourTeam.id, code: data.ourTeam.code, ...(data.ourTeam.shield ? { shield: data.ourTeam.shield } : {}) },
        rival: { id: rival.id, code: rival.code, name: rival.name, ...(rival.shield ? { shield: rival.shield } : {}) },
      },
    });
    this.banner('ATAQUE 1', 'neutral', 'Monta la jugada');
  }

  layout(width: number, height: number): void {
    this.attackView.layout(width, height);
  }

  setPaused(paused: boolean): void {
    if (hud.get().paused !== paused) hud.set({ paused });
  }

  step(): void {
    const input = this.deps.controller.read();
    if (input.device !== hud.get().device) hud.set({ device: input.device });
    if (input.pause && !this.pauseHeld) this.setPaused(!hud.get().paused);
    this.pauseHeld = input.pause;
    if (hud.get().paused) return;
    if (this.freeze > 0) {
      this.freeze--;
      return;
    }
    const events = this.drill.step({ x: input.x, y: input.y, touching: input.touching, shot: input.shot, skill: input.skill });
    for (const event of events) this.handle(event);
    this.deps.sfx.setAmbience(swimActivity(this.drill.all.filter((s) => !s.keeper)), 0, 1 / 60);
    this.refreshHud();
  }

  render(alpha: number, dt: number, profile: QualityProfile): void {
    if (this.slowSeconds > 0) {
      this.slowSeconds -= dt;
      if (this.slowSeconds <= 0) this.timeScale = 1;
    }
    const still = this.freeze > 0 || hud.get().paused;
    this.attackView.render(still ? 1 : alpha, still ? 0 : dt * this.timeScale, profile);
  }

  debugLine(): string {
    const d = this.drill;
    const holder = d.ball.holder ? `${d.ball.holder.team === 0 ? 'nuestro' : 'rival'} ${d.ball.holder.player.number}` : d.ball.flight?.kind ?? 'suelto';
    const preview = d.preview?.candidates
      .slice(0, 3)
      .map((c) => `${c.receiver.player.number}:${c.score.toFixed(2)} r${c.risk.toFixed(2)} ${c.angleError.toFixed(0)}°`)
      .join(' | ');
    const drives = [...d.drives.values()].map((v) => `${v.driver.player.number}:${v.phase} reac ${v.reaction.toFixed(2)}`).join(', ');
    return `${d.phase} · balón ${holder} · boya ${d.post.toFixed(2)}${preview ? ` · pase ${preview}` : ''}${drives ? ` · entradas ${drives}` : ''}`;
  }

  private banner(text: string, tone: BannerTone, detail?: string): void {
    hud.set({ banner: { id: ++this.bannerId, text, tone, ...(detail ? { detail } : {}) } });
  }

  private refreshHud(): void {
    const state = hud.get().attack;
    const clock = Math.ceil(this.drill.clock);
    const s = this.drill.stats;
    if (!state || (clock === this.lastClock && state.goals === s.goals && state.attacks === s.attacks && state.shots === s.shots && state.turnovers === s.turnovers)) return;
    this.lastClock = clock;
    hud.set({ attack: { ...state, clock, attacks: s.attacks, goals: s.goals, shots: s.shots, turnovers: s.turnovers } });
  }

  private handle(event: AttackEvent): void {
    const { sfx, save } = this.deps;
    this.attackView.onEvent(event);
    switch (event.type) {
      case 'attackStart':
        this.banner(`ATAQUE ${event.number}`, 'neutral');
        break;
      case 'whistle':
        sfx.play('whistle');
        break;
      case 'pass':
        sfx.play('throw', 0.35);
        break;
      case 'catch':
        sfx.play('splash', 0.15);
        break;
      case 'noReceiver':
      case 'noDrive':
        sfx.play('click');
        break;
      case 'driveFree':
        sfx.play('charge', 1);
        break;
      case 'release':
        this.lastShotKmh = Math.round(event.plan.speed * 3.6);
        sfx.play('throw', event.plan.speed / 26);
        if (save.settings.vibration) vibrate(18);
        break;
      case 'bounce':
        sfx.play('splash', 0.6);
        break;
      case 'splash':
        sfx.play('splash', event.strength);
        break;
      case 'block':
        sfx.play('save');
        break;
      case 'frame':
        sfx.play('post');
        this.banner('¡AL PALO!', 'neutral');
        break;
      case 'net':
        sfx.play('net');
        break;
      case 'outcome':
        if (event.outcome.type === 'goal') {
          sfx.play('cheer');
          if (save.settings.vibration) vibrate([30, 40, 60]);
        } else if (event.outcome.type === 'save') {
          sfx.play('save');
          if (!event.outcome.held) this.banner('¡RECHACE!', 'neutral', 'Balón suelto');
        }
        break;
      case 'steal':
      case 'intercept':
        sfx.play('groan', 0.6);
        break;
      case 'attackEnd': {
        const banner = RESULT_BANNER[event.result];
        const shot = event.result === 'goal' || event.result === 'save' || event.result === 'miss';
        this.banner(banner.text, banner.tone, shot ? `${this.lastShotKmh} km/h` : banner.detail);
        // The referee whistles a lost possession.
        if (event.result === 'clock' || event.result === 'loose' || event.result === 'steal' || event.result === 'intercept') sfx.play('whistle');
        break;
      }
      default:
        break;
    }
  }
}

/**
 * The attacking half: the whole 3-3 in view and centred on screen. The top of the frame has
 * room for the scoreboard, so the players on the far side are never hidden behind it.
 */
export function frameAttack(camera: Camera, goal: Goal, ballY: number, snap: boolean): void {
  const near = goal.x - goal.facing * 9.2;
  const far = goal.x + goal.facing * BEHIND_GOAL;
  const fit = camera.fit(Math.min(near, far), Math.max(near, far), 3.4, 16.6, 110);
  const halfWidth = camera.width / fit.ppm / 2;
  // Centre on the attack; never show more than a strip of deck behind the goal.
  const centre = goal.x - goal.facing * 3.6;
  const limit = goal.x + goal.facing * (BEHIND_GOAL + 2.5) - goal.facing * halfWidth;
  const x = goal.facing === 1 ? Math.min(centre, limit) : Math.max(centre, limit);
  camera.frame({ x, y: 9.55 + (ballY - 10) * 0.12, ppm: fit.ppm }, snap);
}
