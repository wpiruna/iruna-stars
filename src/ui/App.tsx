import { DebugPanel, RotateOverlay, UpdateToast } from './components/Overlays';
import { Ctx, type AppContext } from './context';
import { DataScreen } from './screens/DataScreen';
import { Install } from './screens/Install';
import { Menu } from './screens/Menu';
import { Settings } from './screens/Settings';
import { Title } from './screens/Title';
import { ui, type ScreenName } from './state';
import { useStore } from './store';

const SCREENS: Record<ScreenName, () => preact.JSX.Element> = {
  title: Title,
  menu: Menu,
  data: DataScreen,
  settings: Settings,
  install: Install,
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
