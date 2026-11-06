import { useState } from 'react';
import { Confirm } from './kit';

export function useConfirm() {
  const [state, setState] = useState<null | Omit<Parameters<typeof Confirm>[0], 'onClose'>>(null);
  const node = state ? <Confirm {...state} onClose={() => setState(null)} /> : null;
  return [node, setState] as const;
}
