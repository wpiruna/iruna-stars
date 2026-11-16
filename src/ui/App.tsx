import { DebugPanel, RotateOverlay, UpdateToast } from './components/Overlays';
import { Ctx, type AppContext } from './context';
import { AttackSetup } from './screens/AttackSetup';
import { DataScreen } from './screens/DataScreen';
import { Install } from './screens/Install';
import { Menu } from './screens/Menu';
import { FriendlySetup } from './screens/FriendlySetup';
import { MatchResult, Play, ShootoutResult } from './screens/Play';
import { Settings } from './screens/Settings';
import { ShootoutSetup } from './screens/ShootoutSetup';
import { Title } from './screens/Title';
import { ui, type ScreenName } from './state';
import { useStore } from './store';

const SCREENS: Record<ScreenName, () => preact.JSX.Element | null> = {
  title: Title,
  menu: Menu,
  data: DataScreen,
  settings: Settings,
  install: Install,
  shootoutSetup: ShootoutSetup,
  attackSetup: AttackSetup,
  friendlySetup: FriendlySetup,
  play: Play,
  shootoutResult: ShootoutResult,
  matchResult: MatchResult,
};

export function App({ context }: { context: AppContext }) {
  const { screen } = useStore(ui);
  const Screen = SCREENS[screen];
  return (
    <Ctx.Provider value={context}>
      <Screen key={screen} />
      <UpdateToast />
      <DebugPanel />
      <RotateOverlay />
    </Ctx.Provider>
  );
}
