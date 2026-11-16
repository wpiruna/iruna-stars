/**
 * A play session: owns one simulation (penalty shoot-out or shooting lab), feeds it the
 * controller every fixed step and turns its events into picture, sound, vibration and HUD.
 */
import type { Container, Renderer } from 'pixi.js';
import type { Sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import { pickPhrase, type GameData } from '../data/load';
import type { Player, Team } from '../data/model';
import type { Controller } from '../input/controller';
import type { SaveStore } from '../persist/storage';
import type { QualityProfile } from '../render/quality';
import { ShotView, type DuelLook } from '../render/shotview';
import type { Duel, DuelEvent } from '../sim/duel/duel';
import { Lab, LAB_SPOTS, type LabSettings } from '../sim/duel/lab';
import { pickKeeper, pickShooters, Shootout, type Kick, type ShootoutEvent, type Side } from '../sim/duel/shootout';
import { fieldFromRules, type Field } from '../sim/field';
import type { ChargeQuality, ShotOutcome, ShotPlan } from '../sim/shooting/model';
import { emptyHud, hud, type BannerTone } from '../ui/hud';
import { vibrate } from './platform';

export type PlayRequest = { kind: 'shootout'; rivalId: string } | { kind: 'lab' };

export interface PlayDeps {
  renderer: Renderer;
  data: GameData;
  save: SaveStore;
  controller: Controller;
  sfx: Sfx;
  /** Called once when a shoot-out is over and its result has been shown. */
  onFinished(): void;
}

const QUALITY_LABEL: Record<ChargeQuality, string> = {
  quick: 'tiro rápido',
  short: 'corto de carga',
  optimal: 'zona óptima',
  over: 'pasado de carga',
};

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  spot: LAB_SPOTS[1] ?? (LAB_SPOTS[0] as (typeof LAB_SPOTS)[number]),
  power: 5,
  accuracy: 5,
  reflexes: 5,
  positioning: 5,
};

export class PlaySession {
  readonly view: Container;
  /** Simulation speed asked by the effects (slow motion). The main loop applies it. */
  timeScale = 1;
  readonly seed: number;

  private readonly field: Field;
  private readonly shotView: ShotView;
  private readonly rng: Rng;
  private shootout: Shootout | null = null;
  private lab: Lab | null = null;
  private shownDuel: Duel | null = null;
  private rival: Team | null = null;
  private freeze = 0;
  private slowSeconds = 0;
  private bannerId = 0;
  private pauseHeld = false;
  private lastAim = '';
  private lastTime: number | null = null;
  private finishTimer = -1;
  private chargeTick = 0;

  constructor(
    private readonly deps: PlayDeps,
    readonly request: PlayRequest,
    labSettings: LabSettings = DEFAULT_LAB_SETTINGS,
  ) {
    const { data } = deps;
    this.seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    this.rng = new Rng(this.seed);
    this.field = fieldFromRules(data.rules);
    this.shotView = new ShotView(deps.renderer, this.field, data.tuning.tiro, this.rng.fork('view'), {
      hitStop: (frames) => (this.freeze = Math.max(this.freeze, frames)),
      slowMotion: (scale, seconds) => {
        this.timeScale = scale;
        this.slowSeconds = seconds;
      },
    });
    this.view = this.shotView.view;
    const duelTuning = { shot: data.tuning.tiro, keeperTuning: data.tuning.portero, penaltyKeeper: data.tuning.penalti.portero };

    if (request.kind === 'shootout') {
      const rival = data.rivals.find((team) => team.id === request.rivalId) ?? (data.rivals[0] as Team);
      this.rival = rival;
      const count = data.rules.tandaPenaltis.lanzadores;
      this.shootout = new Shootout({
        sides: [
          { team: data.ourTeam, shooters: pickShooters(data.ourTeam, count), keeper: pickKeeper(data.ourTeam), human: true },
          { team: rival, shooters: pickShooters(rival, count), keeper: pickKeeper(rival), human: false },
        ],
        first: this.rng.chance(0.5) ? 0 : 1,
        goal: this.field.goalRight,
        penaltyDistance: this.field.fiveMetres,
        kicksPerTeam: count,
        suddenDeath: data.rules.tandaPenaltis.muerteSubita,
        difficulty: deps.save.settings.difficulty,
        duel: duelTuning,
        penalty: data.tuning.penalti,
        rng: this.rng.fork('shootout'),
      });
      hud.set({
        ...emptyHud(),
        mode: 'shootout',
        kicksPerTeam: count,
        teams: [
          { id: data.ourTeam.id, name: data.ourTeam.name, code: data.ourTeam.code, shield: data.ourTeam.shield, kicks: [] },
          { id: rival.id, name: rival.name, code: rival.code, shield: rival.shield, kicks: [] },
        ],
      });
      this.banner('TANDA DE PENALTIS', 'neutral', `${data.ourTeam.code} – ${rival.code}`);
    } else {
      this.lab = new Lab(this.field.goalRight, labSettings, duelTuning, data.tuning.penalti, this.rng.fork('lab'));
      hud.set({ ...emptyHud(), mode: 'lab', role: 'shooter', lab: { shots: 0, goals: 0, saves: 0, posts: 0, misses: 0, last: '' } });
    }
  }

  layout(width: number, height: number): void {
    this.shotView.layout(width, height);
  }

  setPaused(paused: boolean): void {
    if (hud.get().paused === paused) return;
    hud.set({ paused });
  }

  configureLab(settings: LabSettings): void {
    this.lab?.configure(settings);
  }

  resetLabStats(): void {
    if (!this.lab) return;
    this.lab.resetStats();
    hud.set({ lab: { shots: 0, goals: 0, saves: 0, posts: 0, misses: 0, last: '' } });
  }

  /** One fixed simulation step. */
  step(): void {
    const input = this.deps.controller.read();
    if (input.device !== hud.get().device) hud.set({ device: input.device });

    // Pause on the press, not while held.
    if (input.pause && !this.pauseHeld && !hud.get().result) this.setPaused(!hud.get().paused);
    this.pauseHeld = input.pause;
    if (hud.get().paused) return;
    if (this.freeze > 0) {
      this.freeze--;
      return;
    }

    const player = { pad: { x: input.x, y: input.y }, shot: input.shot };
    const events = this.shootout ? this.shootout.step(player) : this.lab ? this.lab.step(player) : [];
    const duel = this.shootout ? this.shootout.duel : (this.lab?.duel ?? null);

    // A new duel started (next kick, next lab shot): point the view at it.
    if (duel && duel !== this.shownDuel) {
      const first = this.shownDuel === null;
      this.shownDuel = duel;
      this.shotView.setDuel(duel, this.lookOf(), first);
    }
    for (const event of events) this.handle(event);
    if (duel) this.refreshHud(duel);

    if (this.finishTimer >= 0) {
      this.finishTimer -= 1 / 60;
      if (this.finishTimer < 0) this.deps.onFinished();
    }
  }

  render(alpha: number, dt: number, profile: QualityProfile): void {
    if (this.slowSeconds > 0) {
      this.slowSeconds -= dt;
      if (this.slowSeconds <= 0) this.timeScale = 1;
    }
    // While frozen or paused the picture holds still on the current state.
    const still = this.freeze > 0 || hud.get().paused;
    this.shotView.render(still ? 1 : alpha, still ? 0 : dt * this.timeScale, profile);
  }

  /** One line for the debug layer: state of the simulation and the last save estimate. */
  debugLine(): string {
    const duel = this.shownDuel;
    if (!duel) return this.shootout?.phase ?? 'lab';
    const save = duel.save ? ` P(parada) ${(duel.save.probability * 100).toFixed(0)} % margen ${duel.save.margin.toFixed(2)} m` : '';
    const plan = duel.plan ? ` ${duel.plan.mode} ${(duel.plan.speed * 3.6).toFixed(0)} km/h ${duel.plan.landing}` : '';
    return `${this.shootout ? `${this.shootout.phase}/` : 'lab/'}${duel.phase} carga ${duel.charge.toFixed(2)}${plan}${save}`;
  }

  private lookOf(): DuelLook {
    const kick = this.shootout?.kick;
    if (kick) {
      return {
        shooter: { color: kick.side === 0 ? 'white' : 'blue', number: kick.shooter.number, leftHanded: kick.shooter.hand === 'left' },
        keeper: { number: kick.keeper.number },
        playerShoots: kick.humanRole === 'shooter',
      };
    }
    return { shooter: { color: 'white', number: 7, leftHanded: false }, keeper: { number: 1 }, playerShoots: true };
  }

  private banner(text: string, tone: BannerTone, detail?: string): void {
    hud.set({ banner: { id: ++this.bannerId, text, tone, ...(detail ? { detail } : {}) } });
  }

  /** Per-step HUD values that change continuously: aim read-out and the shot timer. */
  private refreshHud(duel: Duel): void {
    const state = hud.get();
    let aim = '';
    if (duel.phase === 'charging' && state.role === 'shooter') {
      const side = duel.aim.side === -1 ? 'PALO DE ARRIBA' : duel.aim.side === 1 ? 'PALO DE ABAJO' : 'AL HUECO';
      const mode = duel.aim.mode === 'skip' ? ' · A BOTE' : duel.aim.mode === 'lob' ? ' · VASELINA' : '';
      aim = side + mode;
      // A soft rising tick while the bar fills.
      if (++this.chargeTick % 6 === 0) this.deps.sfx.play('charge', duel.charge);
    }
    const left = duel.phase === 'ready' && Number.isFinite(duel.timeLeft) ? Math.ceil(duel.timeLeft) : null;
    if (aim !== this.lastAim || left !== this.lastTime) {
      this.lastAim = aim;
      this.lastTime = left;
      hud.set({ aim, timeLeft: left });
    }
  }

  private handle(event: ShootoutEvent | DuelEvent): void {
    const { sfx, save } = this.deps;
    this.shotView.onEvent(event as DuelEvent);
    switch (event.type) {
      case 'kickStart':
        this.startKick(event.kick);
        break;
      case 'whistle':
        sfx.play('whistle');
        break;
      case 'release':
        sfx.play('throw', event.plan.speed / 26);
        if (save.settings.vibration && hud.get().role === 'shooter') vibrate(18);
        break;
      case 'bounce':
        sfx.play('splash', 0.6);
        break;
      case 'splash':
        sfx.play('splash', event.strength);
        break;
      case 'frame':
        sfx.play('post');
        break;
      case 'net':
        sfx.play('net');
        break;
      case 'outcome':
        this.showOutcome(event.outcome, event.plan);
        break;
      case 'kickEnd': {
        const teams = hud.get().teams;
        if (teams) {
          const copy: typeof teams = [
            { ...teams[0], kicks: [...teams[0].kicks] },
            { ...teams[1], kicks: [...teams[1].kicks] },
          ];
          copy[event.kick.side].kicks.push(event.scored);
          hud.set({ teams: copy });
        }
        break;
      }
      case 'finished':
        this.finish(event.winner);
        break;
      default:
        break;
    }
  }

  private startKick(kick: Kick): void {
    const ours = kick.side === 0;
    const actor: Player = ours ? kick.shooter : kick.keeper;
    const other: Player = ours ? kick.keeper : kick.shooter;
    hud.set({
      role: kick.humanRole,
      suddenDeath: kick.suddenDeath,
      actor: { number: actor.number, nickname: actor.nickname, keeper: !ours, ...(actor.photos[0] ? { photo: actor.photos[0] } : {}) },
      rival: { number: other.number, nickname: other.nickname },
    });
    const taken = this.shootout?.score.kicks;
    if (kick.suddenDeath && taken && taken[0].length === taken[1].length && taken[0].length === this.shootout?.config.kicksPerTeam) {
      this.banner('¡MUERTE SÚBITA!', 'neutral', 'El primero que falle, pierde');
    }
  }

  private showOutcome(outcome: ShotOutcome, plan: ShotPlan): void {
    const { sfx, save } = this.deps;
    const kick = this.shootout?.kick ?? null;
    // In the lab every shot is ours.
    const ours = kick ? kick.side === 0 : true;
    const speed = `${Math.round(plan.speed * 3.6)} km/h`;
    const detail = `${speed} · ${QUALITY_LABEL[plan.quality]}`;

    if (outcome.type === 'goal') {
      this.banner(outcome.viaPost ? '¡PALO Y GOL!' : '¡GOL!', ours ? 'great' : 'bad', ours ? detail : speed);
      sfx.play(ours ? 'cheer' : 'groan');
      if (save.settings.vibration) vibrate(ours ? [30, 40, 60] : 40);
    } else if (outcome.type === 'save') {
      this.banner(outcome.held ? '¡PARADA!' : '¡PARADÓN!', ours ? 'bad' : 'great', ours ? detail : speed);
      sfx.play('save');
      if (!ours) sfx.play('cheer', 0.8);
    } else if (outcome.type === 'post') {
      this.banner(plan.landing === 'bar' ? '¡AL LARGUERO!' : '¡AL PALO!', ours ? 'bad' : 'great', ours ? detail : speed);
    } else {
      this.banner(outcome.where === 'over' ? '¡ALTA!' : '¡FUERA!', ours ? 'bad' : 'great', ours ? detail : speed);
      if (ours) sfx.play('groan', 0.6);
    }

    if (this.lab) {
      const s = this.lab.stats;
      const chance = s.last?.save ? ` · el portero tenía un ${(s.last.save.probability * 100).toFixed(0)} % de pararlo` : '';
      hud.set({ lab: { shots: s.shots, goals: s.goals, saves: s.saves, posts: s.posts, misses: s.misses, last: `${detail}${chance}` } });
    }
  }

  private finish(winner: Side | null): void {
    const shootout = this.shootout;
    if (!shootout || !this.rival) return;
    const won = winner === 0;
    this.deps.sfx.play('horn');
    const phrase = pickPhrase(this.deps.data, won ? 'victoria' : 'derrota', () => this.rng.next(), this.rival.id, this.rival.name);
    hud.set({ role: null, result: { won, score: [shootout.score.goals(0), shootout.score.goals(1)], phrase } });
    this.banner(won ? '¡VICTORIA!' : 'DERROTA', won ? 'great' : 'bad');
    this.finishTimer = 1.6;
  }
}
