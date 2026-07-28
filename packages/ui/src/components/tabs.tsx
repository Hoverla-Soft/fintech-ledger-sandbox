import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@fintech-ledger-sandbox/ui/lib/utils";

/**
 * Tabbed panels.
 *
 * Base UI handles the roving-focus and `aria-selected` wiring, which is the
 * part hand-rolled tabs usually get wrong — a set of buttons that merely look
 * like tabs is unnavigable by keyboard and unannounced by a screen reader.
 *
 * Added Phase 5g alongside its first consumer, the audit log's
 * all-entries / rejections split.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex w-fit items-center gap-1 rounded-none border p-1", className)}
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-none px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsPanel, TabsTab };
