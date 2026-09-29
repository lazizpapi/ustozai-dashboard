'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-4" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <OctagonX className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': '16px',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
