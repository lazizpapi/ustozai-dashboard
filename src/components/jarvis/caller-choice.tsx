'use client';

import { type FormEvent, useId, useState } from 'react';
import { Check, Languages } from 'lucide-react';
import {
  type CallLanguage,
  type CallerPrefs,
  LANGUAGE_LABELS,
  prefsSummary,
} from '@/lib/jarvis-ui/caller-prefs';
import { personName } from '@/lib/jarvis/person-name';
import { cn } from '@/lib/utils';

const LANGUAGES: CallLanguage[] = ['en', 'uz', 'ru'];

interface CallerChoiceProps {
  prefs: CallerPrefs;
  onChange: (next: CallerPrefs) => void;
  className?: string;
}

/**
 * How Jarvis greets this caller: in which language, and by which name. One
 * quiet line on the welcome screen that opens into the choice. Neither grants
 * anything; the department comes from the sign-in.
 */
export function CallerChoice({ prefs, onChange, className }: CallerChoiceProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(prefs.name);
  const nameId = useId();
  const hintId = useId();
  const typed = name.trim();
  const unusable = typed !== '' && personName(typed) === '';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setName(prefs.name);
          setOpen(true);
        }}
        className={cn(
          'text-foreground/70 hover:text-foreground focus-visible:ring-ring/60 flex min-h-11 items-center gap-2 rounded-full px-3 text-sm outline-none focus-visible:ring-[3px]',
          className
        )}
      >
        <Languages className="size-4" aria-hidden="true" />
        <span>
          {prefsSummary(prefs)}
          <span className="text-muted-foreground"> · {prefs.name ? 'Change' : 'Add your name'}</span>
        </span>
      </button>
    );
  }

  const done = (event: FormEvent) => {
    event.preventDefault();
    if (unusable) return;
    onChange({ ...prefs, name: personName(typed) });
    setOpen(false);
  };

  return (
    <form
      onSubmit={done}
      aria-label="How Jarvis greets you"
      className={cn('jarvis-glass w-full max-w-xs space-y-3 rounded-[22px] p-3', className)}
    >
      <div role="radiogroup" aria-label="Language" className="grid grid-cols-3 gap-1">
        {LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            role="radio"
            aria-checked={prefs.lang === lang}
            onClick={() => onChange({ ...prefs, lang })}
            className={cn(
              'focus-visible:ring-ring/60 h-10 rounded-full text-sm font-medium outline-none transition-colors focus-visible:ring-[3px]',
              prefs.lang === lang
                ? 'bg-primary/15 text-primary'
                : 'text-foreground/70 hover:bg-white/8 hover:text-foreground'
            )}
          >
            {LANGUAGE_LABELS[lang]}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="text-muted-foreground block px-1 text-sm">
          Your first name <span className="text-foreground/45">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            autoComplete="given-name"
            aria-invalid={unusable}
            aria-describedby={unusable ? hintId : undefined}
            className="border-input text-foreground placeholder:text-foreground/40 focus-visible:ring-ring/50 h-10 min-w-0 flex-1 rounded-full border bg-transparent px-4 text-[15px] outline-none focus-visible:ring-2"
          />
          <button
            type="submit"
            aria-label="Done"
            disabled={unusable}
            className="bg-primary text-primary-foreground focus-visible:ring-ring/60 grid size-10 shrink-0 place-items-center rounded-full outline-none transition-[opacity,scale] focus-visible:ring-[3px] active:scale-95 disabled:opacity-30"
          >
            <Check className="size-5" aria-hidden="true" />
          </button>
        </div>
        {unusable && (
          <p id={hintId} className="text-destructive px-1 text-sm">
            Letters only, as you would like to be called.
          </p>
        )}
      </div>
    </form>
  );
}
