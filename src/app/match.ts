/**
 * A full match on screen (F3–F4): builds the Match from the squads, feeds it the controller each
 * fixed step, moves the camera with the play and turns events into picture, sound and HUD: the
 * referee's calls with their reason, exclusions with their countdown, penalties and substitutes.
 */
import type { Renderer } from 'pixi.js';
import type { Sfx } from '../audio/sfx';
import { Rng } from '../core/rng';
import { pickPhrase, type GameData } from '../data/load';
import type { Player, Referee, Team } from '../data/model';
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
import type { Swimmer } from '../sim/attack/types';
import type { MatchEvent } from '../sim/match/types';
import { emptyHud, hud, type BannerTone, type HudBench, type HudBenchPlayer } from '../ui/hud';
import { swimActivity } from './ambience';
import { GoalReplay } from './replay';
import { capsOf, resolveSquad } from './squad';
import type { Goal } from '../sim/field';
import { frameAttack } from './attack';
import { vibrate } from './platform';
import type { DebugCall, Session } from './session';
import { debugParam } from '../debug/config';

const SLOTS: Slot[] = ['boya', 'extremoIzq', 'extremoDer', 'lateralIzq', 'lateralDer', 'cierre'];
const ORDINAL = ['', '1.er', '2.º', '3.er', '4.º', '5.º', '6.º'];
const NTH = ['', '1.ª', '2.ª', '3.ª', '4.ª', '5.ª'];

export interface MatchOptions {
  /** Counter-attack lab instead of a match. */
  counter?: { attackers: number; defenders: number };
  /** Man-up lab: we attack 6x5 or defend 5x6. */
  manUp?: 'attack' | 'defend';
  /** Referee of a friendly; null or missing = drawn at random. */
  refereeId?: string | null;
}

const who = (s: Swimmer): string => `Nº ${s.player.number} ${s.player.nickname.toUpperCase()}`;


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
  readonly counter: { attackers: number; defenders: number } | null;
  readonly manUp: 'attack' | 'defend' | null;
  readonly referee: Referee | null;
  /** What the exclusion tags in the water last said, so they are only redrawn when they change. */
  private readonly tags = new Map<Swimmer, string>();
  /** Team of the last shot, to know whose keeper made a save. */
  private lastShooterTeam: 0 | 1 = 0;
  /** Goal replays (not in the labs): what was recorded, the frame of the last shot, the replay due. */
  private readonly replay: GoalReplay | null;
  private lastRelease = -1;
  private replayDue: { from: number; to: number; goal: Goal } | null = null;
  private replayGoal: Goal | null = null;
  private skipHeld = true;
  /** The goal headline: each scorer's goals in this match, and seconds until it goes (or is gone). */
  private readonly tally = new Map<Player, number>();
  private goalId = 0;
  private goalTimer = -1;
  /** The bench menu (GDD §11.3): why it is open, and Emilio's line. */
  private benchReason: HudBench['reason'] | null = null;
  private benchTip = '';
  /** Seconds until the bench opens in the break between periods (after the horn's caption). */
  private breakTimer = -1;
  /** Emilio's speech bubble: seconds it stays up. */
  private emilioId = 0;
  private emilioTimer = -1;
  /** Changes made this step, for a single caption. */
  private readonly changeNotes: [string[], string[]] = [[], []];

  constructor(
    private readonly deps: MatchDeps,
    readonly rival: Team,
    options: MatchOptions = {},
  ) {
    const { data, save } = deps;
    const counter = options.counter ?? null;
    this.counter = counter;
    this.manUp = options.manUp ?? null;
    this.seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    this.rng = new Rng(this.seed);
    const field = fieldFromRules(data.rules);
    const ours = data.ourTeam;
    const hand = data.tuning.ataque.zona.mano;
    // Ours: the convocatoria (GDD §3.2), with any gap filled in automatically.
    const squad = resolveSquad(ours, save.get().squad, data.rules.convocatoria.suplentes, hand);
    const ourField = squad.field;
    const rivalField = [...pickLineup(rival.players, SLOTS, hand).keys()];
    const bench = (team: Team, lineup: Player[]): Player[] =>
      team.players.filter((p) => p.position !== 'goalkeeper' && !lineup.includes(p)).slice(0, data.rules.convocatoria.suplentes);
    // The friendly's referee, or one at random; in the labs a neutral one.
    const lab = counter !== null || this.manUp !== null;
    const referee =
      data.referees.find((r) => r.id === options.refereeId) ??
      (lab ? (data.referees.find((r) => r.bias === 0) ?? data.referees[0]) : data.referees[Math.floor(this.rng.next() * data.referees.length)]) ??
      null;
    this.referee = referee;
    this.match = new Match({
      field,
      formations: data.formations,
      sides: [
        { team: ours, field: counter ? ourField.slice(0, counter.attackers) : ourField, bench: counter ? [] : squad.bench, keeper: squad.keeper, human: true },
        { team: rival, field: counter ? rivalField.slice(0, counter.defenders) : rivalField, bench: counter ? [] : bench(rival, rivalField), keeper: pickKeeper(rival), human: false },
      ],
      rules: data.rules,
      referee: referee ?? { contactTolerance: 5, exclusionTendency: 5, cardTendency: 5, bias: 0, consistency: 8 },
      refereeTuning: data.tuning.arbitro,
      penalty: data.tuning.penalti,
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
      ...(this.manUp ? { manUp: this.manUp } : {}),
    });
    this.playView = new PlayView(
      deps.renderer,
      field,
      this.match,
      data.tuning.tiro,
      data.tuning.ataque.pase,
      this.rng.fork('view'),
      {
        // During a replay the replay sets the pace.
        hitStop: (frames) => {
          if (!this.replay?.playing) this.freeze = Math.max(this.freeze, frames);
        },
        slowMotion: (scale, seconds) => {
          if (this.replay?.playing) return;
          this.timeScale = scale;
          this.slowSeconds = seconds;
        },
      },
      (camera, snap) => this.direct(camera, snap),
      capsOf(save.settings.cap),
    );
    this.view = this.playView.view;
    // Water always; a crowd only for real matches (the labs are training).
    deps.sfx.startAmbience({ crowd: !lab });
    this.replay = lab ? null : new GoalReplay(this.match.all, this.match.keepers, this.match.ball, data.tuning.partido.repeticion.guardar);
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
        manUp: null,
        referee: referee?.name ?? '',
        stats: null,
      },
    });
    if (this.manUp) {
      const defending = this.manUp === 'defend';
      hud.set({
        mode: 'attack',
        match: null,
        attack: {
          scenario: defending ? 'inferioridad' : 'superioridad',
          clock: Math.ceil(this.match.shotClock),
          attacks: this.match.counterAttempts,
          goals: 0,
          shots: 0,
          turnovers: 0,
          defending,
          ours: { id: ours.id, code: ours.code, ...(ours.shield ? { shield: ours.shield } : {}) },
          rival: { id: rival.id, code: rival.code, name: rival.name, ...(rival.shield ? { shield: rival.shield } : {}) },
        },
      });
      this.banner(defending ? '¡INFERIORIDAD!' : '¡SUPERIORIDAD!', defending ? 'bad' : 'great', defending ? 'Cinco contra seis: aguanta 18 segundos' : 'Seis contra cinco: mueve rápido y busca al libre');
    } else if (counter) {
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
      this.banner(`${ORDINAL[1]} PERIODO`, 'neutral', `${ours.code} – ${rival.code}${referee ? ` · Árbitro: ${referee.name}` : ''}`);
    }
  }

  /** Where the camera looks: the whole pool for the sprint, the ball on the break, the attack when it is set. */
  private direct(camera: Camera, snap: boolean): void {
    const m = this.match;
    const field = m.setup.field;
    const ball = m.ball.pos;
    const att = m.attackingSide;
    if (this.replay?.playing && this.replayGoal) {
      // Replay: closer, between the ball and the goal it went into.
      const goal = this.replayGoal;
      const r = m.setup.match.repeticion;
      // At least 9 m of pool in view, so a penalty is not too tight.
      const span = Math.max(9, Math.abs(ball.x - goal.x) + 4);
      const nearX = goal.x - goal.facing * span;
      const minX = Math.min(nearX, goal.x + goal.facing * BEHIND_GOAL * 0.5);
      const maxX = Math.max(nearX, goal.x + goal.facing * BEHIND_GOAL * 0.5);
      const fit = camera.fit(minX, maxX, Math.min(ball.y, goal.y) - 3.2, Math.max(ball.y, goal.y) + 3.2, 120);
      camera.frame({ x: (Math.max(Math.min(ball.x, Math.max(nearX, goal.x)), Math.min(nearX, goal.x)) + goal.x) / 2, y: (ball.y + goal.y) / 2, ppm: fit.ppm * r.zoom }, snap);
      return;
    }
    switch (m.phase) {
      case 'positional':
        if (att) frameAttack(camera, att.attacks, ball.y, snap);
        return;
      case 'setPiece':
        if (att && (m.setPiece?.kind === 'corner' || m.setPiece?.resume === 'positional')) {
          frameAttack(camera, att.attacks, ball.y, snap);
          return;
        }
        break;
      case 'penalty': {
        // Shooter on the 5 m and the goal, like a goal replay.
        const goal = m.goalOf(m.penalty?.side ?? m.possession ?? 0);
        const fit = camera.fit(Math.min(goal.x, goal.x - goal.facing * 8), Math.max(goal.x, goal.x - goal.facing * 8) + BEHIND_GOAL * 0.5, 4, 16, 90);
        camera.frame({ x: goal.x - goal.facing * 3.4, y: 10, ppm: fit.ppm }, snap);
        return;
      }
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
    if (paused && !this.counter && !this.manUp) hud.set({ timeouts: { left: this.match.timeouts[0], now: this.match.canCallTimeout(0) } });
    if (hud.get().paused !== paused) hud.set({ paused });
  }

  /** The bench menu from the pause: changes for the next dead ball. */
  openBench(): void {
    this.showBench('pause');
  }

  private showBench(reason: HudBench['reason'], tip = ''): void {
    if (this.counter || this.manUp) return;
    this.benchReason = reason;
    this.benchTip = tip;
    this.setPaused(true);
    this.refreshBench();
  }

  private refreshBench(): void {
    if (!this.benchReason) return;
    const m = this.match;
    const card = (s: Swimmer): HudBenchPlayer => ({
      id: s.id,
      number: s.player.number,
      nickname: s.player.nickname,
      position: s.player.position,
      energy: s.energy,
      excluded: s.excluded === true,
      ...(s.player.photos[0] ? { photo: s.player.photos[0] } : {}),
    });
    // The six of the play, the excluded ones included (they cannot go off while they are out).
    const water = [...m.inPlay(0), ...m.exclusions.filter((e) => e.swimmer.team === 0 && !e.forGame).map((e) => e.swimmer)];
    water.sort((a, b) => a.player.number - b.player.number);
    hud.set({
      bench: {
        reason: this.benchReason,
        water: water.map(card),
        bench: [...m.benchOf(0)].sort((a, b) => a.player.number - b.player.number).map(card),
        changes: m.changesOf(0).map((c) => ({ out: c.out.id, in: c.in.id })),
        tip: this.benchTip,
      },
    });
  }

  /** Done with the bench: after a time-out or the break the match goes on; from the pause, back to it. */
  closeBench(): void {
    const reason = this.benchReason;
    if (!reason) return;
    this.benchReason = null;
    hud.set({ bench: null });
    if (reason === 'timeout') {
      const events: MatchEvent[] = [];
      this.match.callTimeout(0, events);
      for (const event of events) this.handle(event);
      this.flushChangeNotes();
    }
    if (reason !== 'pause') this.setPaused(false);
  }

  benchChange(outId: string, inId: string | null): void {
    const m = this.match;
    const out = m.all.find((s) => s.id === outId);
    if (!out) return;
    if (inId === null) m.cancelChange(0, out);
    else {
      const into = m.all.find((s) => s.id === inId);
      if (into) m.requestChange(0, out, into);
    }
    this.deps.sfx.play('click');
    this.refreshBench();
  }

  /** Our time-out (only with the ball): the bench opens with Emilio's advice; it is called when it closes. */
  callTimeout(): void {
    if (!this.match.canCallTimeout(0)) return;
    const { data } = this.deps;
    this.showBench('timeout', pickPhrase(data, 'emilio_tiempo_muerto', () => this.rng.next(), this.rival.id, this.rival.name));
  }

  /** Emilio shouts from the bench, with his photo. */
  private emilio(text: string, whoText?: string): void {
    hud.set({ emilio: { id: ++this.emilioId, text, ...(whoText ? { who: whoText } : {}) } });
    this.emilioTimer = 4.5;
  }

  /** One caption for the changes made at a dead ball (ours and theirs). */
  private flushChangeNotes(): void {
    const [ours, theirs] = this.changeNotes;
    if (ours.length > 0) this.banner('CAMBIO', 'neutral', ours.join(' · '));
    else if (theirs.length > 0) this.banner(`CAMBIO ${this.rival.code}`, 'neutral', theirs.join(' · '));
    ours.length = 0;
    theirs.length = 0;
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
    this.stepGoalHeadline();
    // A goal replay: the match waits; any button skips it.
    const pressed = input.shot || input.skill || input.touching;
    if (this.replay?.playing) {
      if (pressed && !this.skipHeld) this.replay.stop();
      this.skipHeld = pressed;
      if (!this.replay.step((event) => this.playView.onEvent(event))) this.endReplay();
      return;
    }
    const events = this.match.step({ x: input.x, y: input.y, touching: input.touching, shot: input.shot, skill: input.skill });
    this.replay?.record(events);
    for (const event of events) this.handle(event);
    this.flushChangeNotes();
    if (this.emilioTimer >= 0) {
      this.emilioTimer -= 1 / 60;
      if (this.emilioTimer < 0) hud.set({ emilio: null });
    }
    if (this.breakTimer >= 0) {
      this.breakTimer -= 1 / 60;
      // The break between periods: the bench and a word from Emilio (GDD §4).
      if (this.breakTimer < 0) this.showBench('break', pickPhrase(this.deps.data, 'emilio_tiempo_muerto', () => this.rng.next(), this.rival.id, this.rival.name));
    }
    const due = this.replayDue;
    if (due && this.replay && this.replay.frame >= due.to) {
      this.replayDue = null;
      if (this.replay.start(due.from, due.to, this.match.setup.match.repeticion.velocidad)) {
        this.replayGoal = due.goal;
        this.skipHeld = pressed;
        this.timeScale = this.match.setup.match.repeticion.velocidad;
        this.slowSeconds = 0;
        this.playView.setReplay(true);
        this.playView.snapCamera();
        hud.set({ replay: true });
        // The headline stays up for the whole replay and goes with it.
        this.goalTimer = -1;
      }
    }
    this.deps.sfx.setAmbience(swimActivity([...this.match.inPlay(0), ...this.match.inPlay(1)]), this.tension(), 1 / 60);
    this.refreshHud();
    if (this.finishTimer >= 0) {
      this.finishTimer -= 1 / 60;
      if (this.finishTimer < 0) this.deps.onFinished();
    }
  }

  private endReplay(): void {
    this.timeScale = 1;
    this.replayGoal = null;
    this.playView.setReplay(false);
    this.playView.snapCamera();
    hud.set({ replay: false });
    this.hideGoal();
  }

  /** Our goal or theirs, at the top: the scorer's card (his photo if he is ours) and the new score. */
  private showGoal(event: Extract<MatchEvent, { type: 'goal' }>): void {
    const s = event.scorer;
    const tally = s ? (this.tally.get(s.player) ?? 0) + 1 : 0;
    if (s) this.tally.set(s.player, tally);
    // The special photo (the second one) is for moments like this one (GDD §16).
    const photo = s && s.team === 0 ? (s.player.photos[1] ?? s.player.photos[0]) : undefined;
    hud.set({
      goal: {
        id: ++this.goalId,
        ours: event.side === 0,
        scorer: s
          ? { number: s.player.number, nickname: s.player.nickname, position: s.player.position, keeper: s.keeper, ...(photo ? { photo } : {}) }
          : null,
        tally,
        score: [event.score[0], event.score[1]],
        leaving: false,
      },
    });
    // If no replay comes (too short to replay), it goes on its own.
    this.goalTimer = 3.5;
  }

  /** The headline leaves (its exit animation), then it is gone. */
  private hideGoal(): void {
    const goal = hud.get().goal;
    if (!goal || goal.leaving) return;
    hud.set({ goal: { ...goal, leaving: true } });
    this.goalTimer = 0.4;
  }

  private stepGoalHeadline(): void {
    if (this.goalTimer < 0) return;
    this.goalTimer -= 1 / 60;
    if (this.goalTimer >= 0) return;
    if (hud.get().goal?.leaving) hud.set({ goal: null });
    else this.hideGoal();
  }

  /** How close a goal feels, for the crowd: a break with a man free, a shot coming, the clock running out. */
  private tension(): number {
    const m = this.match;
    if (m.phase === 'penalty') return 0.08;
    if (m.phase === 'goal') return 0.6;
    if (m.phase !== 'transition' && m.phase !== 'positional') return 0.15;
    let t = m.phase === 'transition' ? 0.3 : 0.2;
    if (m.advantage) t = 0.75;
    if (m.charging) t = Math.max(t, 0.55);
    if (m.shotClock < 5) t += 0.15;
    if (m.exclusions.length > 0) t += 0.1;
    return t;
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
    const ref = m.referee;
    const refLine = ` · árbitro día ${ref.day >= 0 ? '+' : ''}${ref.day.toFixed(2)}`;
    const out = m.exclusions.map((e) => `${e.swimmer.team === 0 ? 'n' : 'r'}${e.swimmer.player.number}:${Math.ceil(e.left)}`).join(' ');
    const preview = m.preview?.candidates
      .slice(0, 3)
      .map((c) => `${c.receiver.player.number}:${c.score.toFixed(2)} r${c.risk.toFixed(2)}`)
      .join(' | ');
    const energy = m
      .inPlay(0)
      .map((s) => `${s.player.number}:${Math.round(s.energy * 100)}`)
      .join(' ');
    return `${m.phase} · pad ${m.padMode} · balón ${holder}${adv}${sel}${out ? ` · fuera ${out}` : ''}${refLine} · energía ${energy}${preview ? ` · pase ${preview}` : ''}`;
  }

  /** Debug layer: the referee whistles something now (if the ball is in play). */
  debugCall(kind: DebugCall): void {
    const m = this.match;
    if (kind === 'tireOurs' || kind === 'tireRival') {
      // Energy: everybody in the water down to a fifth (Emilio shouts, the AI changes at the next dead ball).
      for (const s of m.inPlay(kind === 'tireOurs' ? 0 : 1)) s.energy = Math.min(s.energy, 0.2);
      return;
    }
    if (m.phase !== 'transition' && m.phase !== 'positional') return;
    if (kind === 'offensiveFoul') {
      // Whoever has the ball shoves his defender.
      const holder = m.ball.holder;
      if (!holder || holder.keeper) return;
      const defender = m.defenderOf(holder) ?? m.inPlay((1 - holder.team) as 0 | 1)[0];
      if (!defender) return;
      for (const event of m.forceCall(holder, defender, 'ordinary', 'EMPUJÓN')) this.handle(event);
      return;
    }
    const offenderTeam = kind === 'exclusionRival' || kind === 'penaltyFor' ? 1 : 0;
    const victims = m.inPlay((1 - offenderTeam) as 0 | 1);
    const holder = m.ball.holder;
    const on = holder && holder.team !== offenderTeam && !holder.keeper ? holder : (victims[0] ?? null);
    const by = (on ? m.defenderOf(on) : null) ?? m.inPlay(offenderTeam)[0];
    if (!by) return;
    const penalty = kind === 'penaltyFor' || kind === 'penaltyAgainst';
    for (const event of m.forceCall(by, on, penalty ? 'penalty' : 'exclusion', penalty ? 'GOL CLARO' : 'AGARRÓN')) this.handle(event);
  }

  private banner(text: string, tone: BannerTone, detail?: string): void {
    hud.set({ banner: { id: ++this.bannerId, text, tone, ...(detail ? { detail } : {}) } });
  }

  /** Over each excluded player, the seconds he has left (or FUERA if he is gone for good). */
  private refreshTags(): void {
    const m = this.match;
    const seen = new Set<Swimmer>();
    for (const ex of m.exclusions) {
      const s = ex.swimmer;
      seen.add(s);
      const text = ex.forGame ? 'FUERA' : ex.canReturn ? '¡VUELVE!' : String(Math.ceil(ex.left));
      if (this.tags.get(s) === text) continue;
      this.tags.set(s, text);
      this.playView.tag(s, text, s.team === 0 ? 0xff8b8b : 0xffd23f);
    }
    for (const s of [...this.tags.keys()]) {
      if (seen.has(s)) continue;
      this.tags.delete(s);
      this.playView.tag(s, null);
    }
  }

  /** A man more or less right now, for the chip under the scoreboard. */
  private manUpState(): { ours: boolean; count: string; seconds: number } | null {
    const m = this.match;
    const ours = m.inPlay(0).length;
    const theirs = m.inPlay(1).length;
    if (ours === theirs) return null;
    const short = ours < theirs ? 0 : 1;
    const left = m.exclusions.filter((e) => e.swimmer.team === short && !e.forGame).map((e) => e.left);
    const seconds = left.length > 0 ? Math.ceil(Math.min(...left)) : 0;
    // Always from our side: 6x5 with a man more, 5x6 with one less.
    return { ours: short === 1, count: `${ours}x${theirs}`, seconds };
  }

  private refreshHud(): void {
    const m = this.match;
    this.refreshTags();
    const lab = hud.get().attack;
    if ((this.counter || this.manUp) && lab) {
      const them = this.manUp === 'defend';
      const next = {
        ...lab,
        clock: Math.ceil(m.shotClock),
        attacks: m.counterAttempts,
        goals: m.score[them ? 1 : 0],
        shots: m.stats[them ? 1 : 0].shots,
        turnovers: m.stats[them ? 1 : 0].turnovers,
      };
      if (JSON.stringify(next) !== JSON.stringify(lab)) hud.set({ attack: next });
      return;
    }
    const state = hud.get().match;
    if (!state) return;
    const manUp = this.manUpState();
    const snapshot = `${m.score.join('-')}|${m.period}|${Math.ceil(m.clock)}|${Math.ceil(m.shotClock)}|${m.possession}|${m.padMode}|${m.phase}|${JSON.stringify(manUp)}`;
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
        manUp,
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
        // Replay it in a moment: from just before the shot (or the last seconds) to the ball in the net.
        if (this.replay) {
          const r = m.setup.match.repeticion;
          const now = this.replay.frame;
          const shot = this.lastRelease >= 0 && now - this.lastRelease < 3 * 60 ? this.lastRelease : now - 60;
          this.replayDue = { from: shot - r.antes * 60, to: now + r.despues * 60, goal: m.goalOf(event.side) };
        }
        // The referee gives it with a long blast, just after the ball hits the net (Julián).
        sfx.play('goalWhistle', 1, 0.3);
        if (this.replay) this.showGoal(event);
        else {
          // The labs keep the plain caption.
          const scorer = event.scorer ? `Nº ${event.scorer.player.number} ${event.scorer.player.nickname.toUpperCase()}` : 'En propia puerta';
          this.banner('¡GOL!', ours ? 'great' : 'bad', `${scorer} · ${event.score[0]}–${event.score[1]}`);
        }
        sfx.crowd(ours ? 'goalUs' : 'goalThem');
        if (save.settings.vibration) vibrate(ours ? [30, 40, 60] : 40);
        break;
      }
      case 'steal':
        if (event.by.team === 0) {
          this.banner('¡ROBO!', 'great');
          sfx.crowd('stealUs');
        }
        break;
      case 'stealTry':
        if (!event.won) sfx.play('splash', 0.3);
        break;
      case 'setPiece':
        if (event.kind === 'corner') this.banner('CÓRNER', 'neutral');
        else if (event.kind === 'freeThrow' && event.reason === 'clock') this.banner('¡POSESIÓN!', event.side === 0 ? 'great' : 'bad', 'Se acabaron los segundos');
        break;
      case 'foul':
        this.onFoul(event);
        break;
      case 'heldCall':
        this.playView.caption('VENTAJA', 0xffd23f, event.on.pos, 1.1);
        break;
      case 'advantagePlayed':
        this.playView.caption('¡VENTAJA BIEN JUGADA!', 0xffd23f, event.on.pos, 1.2);
        break;
      case 'exclusionEnd':
        this.playView.caption(event.reason === 'time' ? '¡VUELVE!' : event.reason === 'goal' ? 'VUELVE TRAS EL GOL' : '¡VUELVE!', 0x7fd3ff, event.who.pos, 1.2);
        sfx.play('click');
        break;
      case 'substitution':
        if (event.chosen) this.changeNotes[event.in.team].push(`sale el ${event.out.player.number}, entra ${who(event.in)}`);
        else this.banner('CAMBIO', 'neutral', `Sale el ${event.out.player.number} · entra ${who(event.in)}`);
        break;
      case 'tired':
        // Emilio wants him out (GDD §11.3).
        this.emilio(pickPhrase(this.deps.data, 'emilio_cambio', () => this.rng.next(), this.rival.id, this.rival.name) || '¡CAMBIO!', who(event.who));
        break;
      case 'timeout':
        this.banner('TIEMPO MUERTO', 'neutral', event.side === 0 ? `${m.setup.sides[0].team.code} · quedan ${m.timeouts[0]}` : `${this.rival.code} · se reanuda desde el medio campo`);
        break;
      case 'rotation':
        this.playView.caption(event.shape, 0x7fd3ff, m.ball.pos, 0.9);
        sfx.play('click');
        break;
      case 'mustPass':
        this.playView.caption('¡PASA!', 0xff8b8b, event.who.pos, 0.9);
        sfx.play('click');
        break;
      case 'penalty':
        if (save.settings.vibration) vibrate([20, 30, 20]);
        break;
      case 'periodEnd': {
        const half = event.period === m.setup.periods / 2;
        const last = event.period === m.setup.periods;
        this.banner(last ? '¡FINAL!' : half ? 'DESCANSO' : `FIN DEL ${ORDINAL[event.period]} PERIODO`, 'neutral', `${m.score[0]}–${m.score[1]}`);
        if (!last && !this.counter && !this.manUp) this.breakTimer = 1.4;
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
        this.lastShooterTeam = event.who.team;
        this.lastRelease = this.replay?.frame ?? -1;
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
      case 'outcome': {
        // The crowd: applause for our keeper, an "ooh" for theirs on a good chance, "¡uuuh!" off the post.
        const difficulty = event.save ? 1 - event.save.probability : 0.5;
        if (event.outcome.type === 'save') {
          sfx.play('save');
          if (this.lastShooterTeam === 1) sfx.crowd('saveUs', 0.4 + difficulty);
          else if (difficulty > 0.35) sfx.crowd('saveThem', 0.5 + difficulty);
        } else if (event.outcome.type === 'post') sfx.crowd('post');
        else if (event.outcome.type === 'goal' && event.outcome.blunder) {
          // The Inseguro keeper's howler (GDD §10).
          this.playView.caption('¡CANTADA!', 0xffd23f, m.ball.pos, 1.4);
        }
        break;
      }
      case 'intercept':
        if (event.by.keeper) this.playView.caption('¡SALIDA!', event.by.team === 0 ? 0x7fd3ff : 0xffd23f, event.by.pos, 1.1);
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

  /** The referee's call: a caption with the reason, and a banner for the ones that matter. */
  private onFoul(event: Extract<MatchEvent, { type: 'foul' }>): void {
    const { sfx, save } = this.deps;
    const ours = event.by.team === 0;
    const tone = ours ? 'bad' : 'great';
    const personal = event.personal > 0 ? ` · ${NTH[event.personal] ?? `${event.personal}.ª`} falta` : '';
    // The reason, where the foul was made (the offender carries his countdown).
    const at = event.on?.pos ?? event.by.pos;
    this.playView.caption(event.offensive ? 'FALTA EN ATAQUE' : event.motive, ours ? 0xff8b8b : 0xffd23f, { x: at.x, y: at.y - 0.6 }, 1.3);
    if (event.sanction === 'violent') {
      this.banner('¡ROJA DIRECTA!', tone, `${who(event.by)} · ${event.motive} · penalti y 4 minutos sin sustituto`);
    } else if (event.out && event.card === 'red') {
      this.banner('TARJETA ROJA', tone, `${who(event.by)} · fuera todo el partido`);
    } else if (event.out) {
      this.banner('¡EXPULSADO!', tone, `${who(event.by)} · ${event.personal} faltas personales: entra un suplente`);
    } else if (event.sanction === 'penalty') {
      this.banner('¡PENALTI!', tone, `${event.motive} · ${who(event.by)}${personal}`);
    } else if (event.sanction === 'exclusion') {
      const card = event.card === 'yellow' ? ' · AMARILLA' : '';
      this.banner(event.motive, tone, `Exclusión de ${who(event.by)}${personal}${card} · ${ours ? '¡INFERIORIDAD!' : '¡SUPERIORIDAD!'}`);
      if (ours && save.settings.vibration) vibrate(40);
    } else if (event.card === 'yellow') {
      this.banner('TARJETA AMARILLA', tone, `${who(event.by)} · ${event.motive}: la próxima es roja`);
    } else if (event.offensive) {
      // The team with the ball loses it.
      this.banner('FALTA EN ATAQUE', tone, `${who(event.by)} · ${event.motive} · ${ours ? 'balón para ellos' : 'balón nuestro'}`);
    }
    if (event.teamWarning) this.banner('AMARILLA AL EQUIPO', tone, 'Demasiadas faltas: la próxima fuerte será roja');
    // The crowd boos the referee when he sends one of ours off, and cheers the other way round.
    if (event.sanction === 'ordinary') sfx.play('click', 0.4);
    else sfx.crowd(ours ? 'exclusionUs' : 'exclusionThem');
  }

  private finish(): void {
    const m = this.match;
    const [ours, theirs] = m.score;
    const outcome = ours > theirs ? 'won' : ours < theirs ? 'lost' : 'draw';
    if (outcome === 'won') this.deps.sfx.crowd('win');
    else this.deps.sfx.crowd('lose');
    const phrase = outcome === 'draw' ? '' : pickPhrase(this.deps.data, outcome === 'won' ? 'victoria' : 'derrota', () => this.rng.next(), this.rival.id, this.rival.name);
    const state = hud.get().match;
    if (state) hud.set({ match: { ...state, stats: [{ ...m.stats[0] }, { ...m.stats[1] }] } });
    hud.set({ result: { won: outcome === 'won', draw: outcome === 'draw', score: [ours, theirs], phrase } });
    this.finishTimer = 2.2;
  }
}
