import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@fintech-ledger-sandbox/ui/components/dialog";
import { cn } from "@fintech-ledger-sandbox/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  FlaskConical,
  type LucideIcon,
  Monitor,
  Moon,
  RotateCcw,
  Search,
  Sun,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@/components/theme-provider";
import { useOrgContext } from "@/lib/org/session";

import { type ConsolePath, NAV_GROUPS } from "./nav";
import { shortcutLabel } from "./shortcut";

/**
 * Keyboard-first navigation over the console.
 *
 * Two rules shape what is in here. It only offers what the ledger can actually
 * do — there is no command for a capability this API does not implement — and
 * write commands are withheld from a `viewer` as a courtesy, exactly as the
 * screens withhold their buttons. That is never enforcement: the role comes
 * from a session Better Auth may have cached, and the server re-derives it on
 * every request (`docs/product/roles-and-permissions/ledger.md`).
 *
 * Commands in the Actions group navigate to the screen that owns the form
 * rather than pretending to submit anything, and each one says so. A palette
 * entry that implies it will post a transaction and instead opens a page is the
 * kind of small lie that makes an operator stop trusting the tool.
 */

interface Command {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly group: string;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { canWrite } = useOrgContext();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const commands = useMemo<readonly Command[]>(() => {
    function go(to: ConsolePath) {
      return () => {
        void navigate({ to });
      };
    }

    const navigation = NAV_GROUPS.flatMap((group) =>
      group.items.map(
        (item): Command => ({
          id: `nav:${item.to}`,
          label: item.label,
          hint: item.hint,
          group: group.label,
          icon: item.icon,
          run: go(item.to),
        }),
      ),
    );

    const actions: readonly Command[] = canWrite
      ? [
          {
            id: "action:transfer",
            label: "Post a transfer",
            hint: "Opens the transfer screen to build a balanced transaction",
            group: "Actions",
            icon: ArrowLeftRight,
            run: go("/transfer"),
          },
          {
            id: "action:new-account",
            label: "Open a new account",
            hint: "Opens the accounts screen, where the create form lives",
            group: "Actions",
            icon: Wallet,
            run: go("/accounts"),
          },
          {
            id: "action:seed",
            label: "Seed the sandbox",
            hint: "Opens the sandbox screen to post the demo scenarios",
            group: "Actions",
            icon: FlaskConical,
            run: go("/sandbox"),
          },
          {
            id: "action:reset",
            label: "Reset balances to zero",
            hint: "Opens the sandbox screen; reset posts compensating entries, it never deletes history",
            group: "Actions",
            icon: RotateCcw,
            run: go("/sandbox"),
          },
        ]
      : [];

    const appearance: readonly Command[] = [
      {
        id: "theme:light",
        label: "Light theme",
        hint: "Use the light colour scheme",
        group: "Appearance",
        icon: Sun,
        run: () => setTheme("light"),
      },
      {
        id: "theme:dark",
        label: "Dark theme",
        hint: "Use the dark colour scheme",
        group: "Appearance",
        icon: Moon,
        run: () => setTheme("dark"),
      },
      {
        id: "theme:system",
        label: "Match system theme",
        hint: "Follow the operating system's colour scheme",
        group: "Appearance",
        icon: Monitor,
        run: () => setTheme("system"),
      },
    ];

    return [...navigation, ...actions, ...appearance];
  }, [canWrite, navigate, setTheme]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return commands;
    }
    return commands.filter((command) =>
      `${command.label} ${command.hint} ${command.group}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  // A stale highlight after the list shrinks would run whichever command
  // happened to slide into that position.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      // Focused explicitly rather than with `autoFocus`: the palette is opened
      // by a keystroke in order to be typed into, and leaving the initial focus
      // to the dialog's own heuristic risks the operator's next keypress
      // landing on the page behind it.
      inputRef.current?.focus();
    } else {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  function runAt(index: number) {
    const command = results[index];
    if (!command) {
      return;
    }
    // Closing first keeps focus restoration on the trigger rather than on a
    // screen that is about to unmount underneath it.
    onOpenChange(false);
    command.run();
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(results.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(activeIndex);
    }
  }

  const activeId = results[activeIndex] ? `command-${results[activeIndex].id}` : undefined;

  // Runs of the same group, carrying each command's index in the flat result
  // list so the keyboard's single cursor and the rendered grouping cannot
  // disagree about which row is highlighted.
  const groups: { group: string; entries: { command: Command; index: number }[] }[] = [];
  results.forEach((command, index) => {
    const current = groups.at(-1);
    if (current && current.group === command.group) {
      current.entries.push({ command, index });
    } else {
      groups.push({ group: command.group, entries: [{ command, index }] });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12vh] max-w-[32rem] translate-y-0 gap-0 overflow-hidden p-0 duration-[180ms] ease-out-expo data-[ending-style]:scale-[0.98] data-[starting-style]:scale-[0.98]"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search the console and jump to a screen. Use the arrow keys to move and Enter to select.
        </DialogDescription>

        <div className="flex items-center gap-2.5 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="command-palette-results"
            aria-activedescendant={activeId}
            aria-label="Search commands"
            placeholder="Search or jump to…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {results.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No command matches “{query.trim()}”.
          </p>
        ) : (
          <div
            ref={listRef}
            id="command-palette-results"
            role="listbox"
            aria-label="Commands"
            className="max-h-[21rem] overflow-y-auto p-1.5"
          >
            {groups.map(({ group, entries }, groupIndex) => (
              // biome-ignore lint/a11y/useSemanticElements: the rule suggests <fieldset>, which is not a permitted child of a listbox; role="group" is what WAI-ARIA specifies for grouping options.
              <div key={group} role="group" aria-label={group}>
                <div
                  aria-hidden="true"
                  className={cn(
                    "px-2.5 pb-1 text-label text-muted-foreground uppercase",
                    groupIndex === 0 ? "pt-1" : "pt-3",
                  )}
                >
                  {group}
                </div>
                {entries.map(({ command, index }) => (
                  /*
                   * A real button, not a div with a role. Focus stays on the
                   * input — this is an `aria-activedescendant` combobox, so an
                   * option must not be a tab stop — but a button is still
                   * focusable, and its native activation means the pointer and
                   * the keyboard reach `runAt` through the same path instead of
                   * two handlers that can drift apart.
                   */
                  <button
                    key={command.id}
                    type="button"
                    id={`command-${command.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex}
                    onClick={() => runAt(index)}
                    onMouseMove={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm",
                      index === activeIndex && "bg-accent text-accent-foreground",
                    )}
                  >
                    <command.icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="shrink-0 font-medium">{command.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{command.hint}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 border-t bg-background px-3 py-2 text-xs text-muted-foreground">
          <span>
            <kbd className="font-mono">↑↓</kbd> move
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> select
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
          <span className="ml-auto font-mono">{shortcutLabel()}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
