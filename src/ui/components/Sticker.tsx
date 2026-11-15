/** The player "cromo" (GDD §16): photo, dorsal, nickname, position and bars. */
import { imageUrl, playerPlaceholder } from '../../data/images';
import { KEEPER_STAT_ORDER, POSITION_LABEL, STAT_LABEL, STAT_ORDER, type Player } from '../../data/model';

export function Portrait({ player, special = false }: { player: Player; special?: boolean }) {
  const key = special ? (player.photos[1] ?? player.photos[0]) : player.photos[0];
  const photo = imageUrl(key);
  const src = photo ?? playerPlaceholder(player.number, player.position === 'goalkeeper');
  return (
    <div class={`portrait${photo ? ' portrait--photo' : ''}`}>
      <img src={src} alt="" draggable={false} />
    </div>
  );
}

export function Sticker({ player }: { player: Player }) {
  const bars = STAT_ORDER.map((key) => ({ label: STAT_LABEL[key], value: player.stats[key] }));
  if (player.keeperStats) {
    for (const key of KEEPER_STAT_ORDER) bars.push({ label: STAT_LABEL[key], value: player.keeperStats[key] });
  }
  return (
    <article class={`sticker sticker--${player.position}${player.origin === 'provisional' ? ' sticker--provisional' : ''}`}>
      <div class="sticker__photo">
        <Portrait player={player} />
        <span class="sticker__number">{player.number}</span>
        {player.origin === 'provisional' && <span class="sticker__ribbon">PROVISIONAL</span>}
      </div>
      <div class="sticker__name">{player.nickname}</div>
      <div class="sticker__position">
        {POSITION_LABEL[player.position]}
        {player.hand === 'left' ? ' · Zurdo' : ''}
      </div>
      <div class="sticker__bars" aria-hidden="true">
        {bars.map((bar) => (
          <span class="sticker__bar" title={`${bar.label}: ${bar.value}`}>
            <i style={{ height: `${bar.value * 10}%` }} />
          </span>
        ))}
      </div>
      {player.emptyBars > 0 && <div class="sticker__note">{player.emptyBars} barras sin rellenar</div>}
    </article>
  );
}
