import { useCallback, useEffect, useRef, useState } from "react";
/** Keep the display snapshot until Ant Design finishes closing, including a
 * switch to a different target. Business state can close immediately. */
export function useRetainedDialog<T>(value: T | undefined) {
  const requested = useRef(value);
  requested.current = value;
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (shown === undefined && value !== undefined) setShown(value);
  }, [shown, value]);
  const afterClose = useCallback(() => {
    setShown((current) => (current === shown ? requested.current : current));
  }, [shown]);
  return {
    value: shown,
    open: shown !== undefined && shown === value,
    afterClose,
  };
}
export interface RetainedDialogProps {
  open: boolean;
  afterClose(): void;
}
