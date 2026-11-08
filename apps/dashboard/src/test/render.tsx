import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/Toast';

/** Renders inside the toast provider and returns a userEvent instance. */
export function renderUi(ui: ReactElement) {
  const user = userEvent.setup();
  const utils = render(<ToastProvider>{ui}</ToastProvider>);
  return { user, ...utils };
}
