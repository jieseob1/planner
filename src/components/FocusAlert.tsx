import { useEffect, useRef } from 'react';

interface FocusAlertProps {
  message: string;
  className?: string;
}

export function FocusAlert({ message, className = 'inline-alert' }: FocusAlertProps) {
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alertRef.current?.focus();
  }, [message]);

  return (
    <div ref={alertRef} className={className} role="alert" tabIndex={-1}>
      {message}
    </div>
  );
}
