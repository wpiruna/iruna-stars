import { imageUrl } from '../../data/images';
import { Shield } from '../components/Shield';
import { useApp } from '../context';
import { ui } from '../state';
import { useStore } from '../store';

const START_HINT = { touch: 'Toca para empezar', keyboard: 'Pulsa una tecla o haz clic', gamepad: 'Pulsa un botón' } as const;

/** The logo is drawn with code; if the user provides assets/logo/logo.png, that one is used. */
export function Logo({ compact = false }: { compact?: boolean }) {
  const { data } = useApp();
  const custom = imageUrl(data.club.logo);
  if (custom) return <img class={`logo-image${compact ? ' logo-image--compact' : ''}`} src={custom} alt="Waterpolo Iruña Stars 26-27" />;
  return (
    <h1 class={`logo${compact ? ' logo--compact' : ''}`} aria-label="Waterpolo Iruña Stars 26-27">
      <span class="logo__top">WATERPOLO</span>
      <span class="logo__main" data-text="IRUÑA STARS">
        IRUÑA STARS
      </span>
      <span class="logo__season">26-27</span>
    </h1>
  );
}

export function Title() {
  const { data, actions } = useApp();
  const { device } = useStore(ui);
  return (
    <section class="screen title" onClick={actions.start}>
      <div class="title__shield">
        <Shield id="nuestro" code={data.club.code} image={data.ourTeam.shield} size={7} />
      </div>
      <Logo />
      <p class="title__start">{START_HINT[device]}</p>
      <p class="title__club">{data.club.name}</p>
    </section>
  );
}
