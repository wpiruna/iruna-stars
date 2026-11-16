/**
 * A full match on screen (F3): builds the Match from the squads, feeds it the controller each
 * fixed step, moves the camera with the play and turns events into picture, sound and HUD.
 */
import type { Renderer } from 'pixi.js';
import type { Sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import { pickPhrase, type GameData } from '../data/load';
import type { Team } from '../data/model';
import type { Controller } from '../input/controller';
import type { SaveStore } from '../persist/storage';
import { TILT, type Camera } from '../render/camera';
import { BEHIND_GOAL } from '../render/pool';
import { PlayView } from '../render/playview';
import type { QualityProfile } from '../render/quality';
import { pickLineup } from '../sim/attack/formation';
import type { Slot } from '../sim/attack/types';
import { pickKeeper } from '../sim/duel/shootout';
import { fieldFromRules } from '../sim/field';
import { Match } from '../sim/match/match';
import type { MatchEvent } from '../sim/match/types';
import { emptyHud, hud, type BannerTone } from '../ui/hud';
import { frameAttack } from './attack';
import { vibrate } from './platform';
import type { Session } from './session';
import { debugParam } from '../debug/config';

const SLOTS: Slot[] = ['boya', 'extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre'];
const ORDINAL = ['', '1.er', '2.º', '3.er', '4.º', '5.º', '6.º'];

export interface MatchDeps {
  renderer: Renderer;
  data: GameData;
  save: SaveStore;
  controller: Controller;
  sfx: Sfx;
  onFinished(): void;
}

export class MatchSession implements Session {
  readonly view;
  readonly seed: number;
  timeScale = 1;
  readonly match: Match;
  private readonly playView: PlayView;
  private freeze = 0;
  private slowSeconds = 0;
  private bannerId = 0;
  private pauseHeld = false;
  private lastSnapshot = '';
  private finishTimer = -1;
  private readonly rng: Rng;

  constructor(
    private readonly deps: MatchDeps,
    readonly rival: Team,
    /** Counter-attack lab instead of a match. */
    readonly counter: { attackers: number; defenders: number } | null = null,
  ) {
    const { data, save } = deps;
    this.seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    this.rng = new Rng(this.seed);
    const field = fieldFromRules(data.rules);
    const ours = data.ourTeam;
    const ourField = [...pickLineup(ours.players, SLOTS).keys()];
    const rivalField = [...pickLineup(rival.players, SLOTS).keys()];
    this.match = new Match({
      field,
      formations: data.formations,
      sides: [
        { team: ours, field: counter ? ourField.slice(0, counter.attackers) : ourField, keeper: pickKeeper(ours), human: true },
        { team: rival, field: counter ? rivalField.slice(0, counter.defenders) : rivalField, keeper: pickKeeper(rival), human: false },
      ],
      periods: data.rules.partido.periodos,
      // `?minutos=1` shortens the periods for testing (debug builds only).
      periodSeconds: (Number(debugParam('minutos')) || data.rules.partido.minutosMarcador) * 60,
      clockSpeed: data.rules.velocidadRelojes.partido,
      possession: {
        first: data.rules.posesion.primera,
        second: data.rules.posesion.segunda,
        clockSpeed: data.rules.velocidadRelojes.posesion,
      },
      tuning: data.tuning.ataque,
      match: data.tuning.partido,
      shot: data.tuning.tiro,
      keeperTuning: data.tuning.portero,
      tilt: TILT,
      rng: this.rng.fork('match'),
      difficulty: save.settings.difficulty,
      tapMs: data.tuning.controles.umbralToqueMs.teclado,
      autoSwitch: save.settings.autoSwitchDefender,
      ...(counter ? { counter } : {}),
    });
    this.playView = new PlayView(
      deps.renderer,
      field,
      this.match,
      data.tuning.tiro,
      data.tuning.ataque.pase,
      this.rng.fork('view'),
      {
        hitStop: (frames) => (this.freeze = Math.max(this.freeze, frames)),
        slowMotion: (scale, seconds) => {
          this.timeScale = scale;
          this.slowSeconds = seconds;
        },
      },
      (camera, snap) => this.direct(camera, snap),
    );
    this.view = this.playView.view;
    hud.set({
      ...emptyHud(),
      mode: 'match',
      match: {
        ours: { id: ours.id, code: ours.code, name: ours.name, ...(ours.shield ? { shield: ours.shield } : {}) },
        rival: { id: rival.id, code: rival.code, name: rival.name, ...(rival.shield ? { shield: rival.shield } : {}) },
        score: [0, 0],
        period: 1,
        periods: data.rules.partido.periodos,
        clock: this.match.clock,
        shotClock: data.rules.posesion.primera,
        possession: null,
        padMode: 'none',
        phase: 'swimOffReady',
        stats: null,
      },
    });
    if (counter) {
      hud.set({
        mode: 'attack',
        match: null,
        attack: {
          scenario: counter.attackers === 2 ? 'contra2x1' : 'contra3x2',
          clock: Math.ceil(this.match.shotClock),
          attacks: this.match.counterAttempts,
          goals: 0,
          shots: 0,
          turnovers: 0,
          ours: { id: ours.id, code: ours.code, ...(ours.shield ? { shield: ours.shield } : {}) },
          rival: { id: rival.id, code: rival.code, name: rival.name, ...(rival.shield ? { shield: rival.shield } : {}) },
        },
      });
      this.banner(`¡CONTRA ${counter.attackers}x${counter.defenders}!`, 'great', 'Nada con el balón y pasa al que quede libre');
    } else {
      this.banner(`${ORDINAL[1]} PERIODO`, 'neutral', `${ours.code} – ${rival.code}`);
    }
  }

  /** Where the camera looks: the whole pool for the sprint, the ball on the break, the attack when it is set. */
  private direct(camera: Camera, snap: boolean): void {
    const m = this.match;
    const field = m.setup.field;
    const ball = m.ball.pos;
    const att = m.attackingSide;
    switch (m.phase) {
      case 'positional':
        if (att) frameAttack(camera, att.attacks, ball.y, snap);
        return;
      case 'setPiece':
        if (att && m.setPiece?.kind === 'corner') {
          frameAttack(camera, att.attacks, ball.y, snap);
          return;
        }
        break;
      case 'goal': {
        const goal = m.goalOf(m.score[0] + m.score[1] > 0 ? (m.lastScorer?.team ?? 0) : 0);
        const fit = camera.fit(Math.min(goal.x, goal.x - goal.facing * 7), Math.max(goal.x, goal.x - goal.facing * 7) + BEHIND_GOAL * 0.5, 4, 16, 90);
        camera.frame({ x: goal.x - goal.facing * 2.6, y: 10, ppm: fit.ppm }, snap);
        return;
      }
      case 'swimOffReady':
      case 'swimOff':
      case 'periodEnd':
      case 'fullTime': {
        const fit = camera.fit(field.length / 2 - 8, field.length / 2 + 8, 0.5, field.width - 0.5, m.setup.match.camara.sprint);
        camera.frame({ x: field.length / 2, y: field.width / 2, ppm: fit.ppm }, snap);
        return;
      }
      default:
        break;
    }
    // On the move: follow the ball, looking ahead towards the goal being attacked.
    const facing = att ? att.attacks.facing : 1;
    const ppm = Math.max(camera.fit(0, 1, 1, field.width - 1, 200).ppm, m.setup.match.camara.transicion);
    const half = camera.width / ppm / 2;
    const x = Math.min(Math.max(ball.x + facing * m.setup.match.camara.adelanto, half - BEHIND_GOAL - 1), field.length + BEHIND_GOAL + 1 - half);
    camera.frame({ x, y: 10 + (ball.y - 10) * 0.25, ppm }, snap);
  }

  layout(width: number, height: number): void {
    this.playView.layout(width, height);
  }

  setPaused(paused: boolean): void {
    if (hud.get().paused !== paused) hud.set({ paused });
  }

  step(): void {
    const input = this.deps.controller.read();
    if (input.device !== hud.get().device) {
      hud.set({ device: input.device });
      this.match.tapMs = this.deps.data.tuning.controles.umbralToqueMs[input.device === 'touch' ? 'tactil' : input.device === 'gamepad' ? 'mando' : 'teclado'];
    }
    if (input.pause && !this.pauseHeld && !hud.get().result) this.setPaused(!hud.get().paused);
    this.pauseHeld = input.pause;
    if (hud.get().paused) return;
    if (this.freeze > 0) {
      this.freeze--;
      return;
    }
    const events = this.match.step({ x: input.x, y: input.y, touching: input.touching, shot: input.shot, skill: input.skill });
    for (const event of events) this.handle(event);
    this.refreshHud();
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
    const still = this.freeze > 0 || hud.get().paused;
    this.playView.render(still ? 1 : alpha, still ? 0 : dt * this.timeScale, profile);
  }

  debugLine(): string {
    const m = this.match;
    const h = m.ball.holder;
    const holder = h ? `${h.team === 0 ? 'nuestro' : 'rival'} ${h.player.number}${h.keeper ? ' (portero)' : ''}` : (m.ball.flight?.kind ?? (m.ball.free ? 'suelto' : '—'));
    const adv = m.advantage ? ` · ${m.advantage.attackers}x${m.advantage.defenders}` : '';
    const sel = m.selected ? ` · defiendes con el ${m.selected.player.number}` : '';
    const preview = m.preview?.candidates
      .slice(0, 3)
      .map((c) => `${c.receiver.player.number}:${c.score.toFixed(2)} r${c.risk.toFixed(2)}`)
      .join(' | ');
    return `${m.phase} · pad ${m.padMode} · balón ${holder}${adv}${sel}${preview ? ` · pase ${preview}` : ''}`;
  }

  private banner(text: string, tone: BannerTone, detail?: string): void {
    hud.set({ banner: { id: ++this.bannerId, text, tone, ...(detail ? { detail } : {}) } });
  }

  private refreshHud(): void {
    const m = this.match;
    const lab = hud.get().attack;
    if (this.counter && lab) {
      const next = { ...lab, clock: Math.ceil(m.shotClock), attacks: m.counterAttempts, goals: m.score[0], shots: m.stats[0].shots, turnovers: m.stats[0].turnovers };
      if (JSON.stringify(next) !== JSON.stringify(lab)) hud.set({ attack: next });
      return;
    }
    const state = hud.get().match;
    if (!state) return;
    const snapshot = `${m.score.join('-')}|${m.period}|${Math.ceil(m.clock)}|${Math.ceil(m.shotClock)}|${m.possession}|${m.padMode}|${m.phase}`;
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    hud.set({
      match: {
        ...state,
        score: [m.score[0], m.score[1]],
        period: m.period,
        clock: Math.ceil(m.clock),
        shotClock: Math.ceil(m.shotClock),
        possession: m.possession,
        padMode: m.padMode,
        phase: m.phase,
      },
    });
  }

  private handle(event: MatchEvent): void {
    const { sfx, save } = this.deps;
    this.playView.onEvent(event);
    const m = this.match;
    switch (event.type) {
      case 'whistle':
        sfx.play('whistle');
        break;
      case 'horn':
        sfx.play('horn');
        break;
      case 'swimOffWon':
        this.banner(event.by.team === 0 ? '¡SPRINT GANADO!' : 'SPRINT PERDIDO', event.by.team === 0 ? 'great' : 'bad');
        break;
      case 'advantage': {
        const ours = m.possession === 0;
        this.banner(event.defenders === 0 ? '¡SOLO ANTE EL PORTERO!' : `¡CONTRA ${event.attackers}x${event.defenders}!`, ours ? 'great' : 'bad', ours ? undefined : '¡Atrás!');
        break;
      }
      case 'goal': {
        const ours = event.side === 0;
        const scorer = event.scorer ? `Nº ${event.scorer.player.number} ${event.scorer.player.nickname.toUpperCase()}` : 'En propia puerta';
        this.banner('¡GOL!', ours ? 'great' : 'bad', `${scorer} · ${event.score[0]}–${event.score[1]}`);
        sfx.play(ours ? 'cheer' : 'groan');
        if (save.settings.vibration) vibrate(ours ? [30, 40, 60] : 40);
        break;
      }
      case 'steal':
        if (event.by.team === 0) this.banner('¡ROBO!', 'great');
        sfx.play(event.by.team === 0 ? 'cheer' : 'groan', 0.5);
        break;
      case 'stealTry':
        if (!event.won) sfx.play('splash', 0.3);
        break;
      case 'setPiece':
        if (event.kind === 'corner') this.banner('CÓRNER', 'neutral');
        else if (event.kind === 'freeThrow') this.banner('¡POSESIÓN!', event.side === 0 ? 'great' : 'bad', 'Se acabaron los segundos');
        break;
      case 'periodEnd': {
        const half = event.period === m.setup.periods / 2;
        const last = event.period === m.setup.periods;
        this.banner(last ? '¡FINAL!' : half ? 'DESCANSO' : `FIN DEL ${ORDINAL[event.period]} PERIODO`, 'neutral', `${m.score[0]}–${m.score[1]}`);
        break;
      }
      case 'phase':
        if (event.phase === 'swimOffReady' && m.period > 1) this.banner(`${ORDINAL[m.period]} PERIODO`, 'neutral', '¡Machaca HABILIDAD en el sprint!');
        break;
      case 'fullTime':
        this.finish();
        break;
      case 'pass':
        if (event.passer.team === 0) sfx.play('throw', 0.35);
        break;
      case 'catch':
        sfx.play('splash', 0.15);
        break;
      case 'release':
        sfx.play('throw', event.plan.speed / 26);
        if (event.who.team === 0 && save.settings.vibration) vibrate(18);
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
        break;
      case 'net':
        sfx.play('net');
        break;
      case 'outcome':
        if (event.outcome.type === 'save') sfx.play('save');
        break;
      case 'switch':
      case 'noReceiver':
      case 'noDrive':
        sfx.play('click');
        break;
      case 'driveFree':
        sfx.play('charge', 1);
        break;
      default:
        break;
    }
  }

  private finish(): void {
    const m = this.match;
    const [ours, theirs] = m.score;
    const outcome = ours > theirs ? 'won' : ours < theirs ? 'lost' : 'draw';
    const phrase = outcome === 'draw' ? '' : pickPhrase(this.deps.data, outcome === 'won' ? 'victoria' : 'derrota', () => this.rng.next(), this.rival.id, this.rival.name);
    const state = hud.get().match;
    if (state) hud.set({ match: { ...state, stats: [{ ...m.stats[0] }, { ...m.stats[1] }] } });
    hud.set({ result: { won: outcome === 'won', draw: outcome === 'draw', score: [ours, theirs], phrase } });
    this.finishTimer = 2.2;
  }
}
