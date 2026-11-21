// Which app this phone is running: the front app (front staff: Catering only)
// or the manager app (everything). Both are the same code at two links: #/front and #/manager.
import { createContext, useContext } from 'react';

export type AppMode = 'front' | 'manager';

const Mode = createContext<AppMode>('manager');
export const AppModeProvider = Mode.Provider;
export const useAppMode = () => useContext(Mode);
/** The start of every link inside this app: '/front' or '/manager'. */
export const useAppBase = () => '/' + useContext(Mode);
