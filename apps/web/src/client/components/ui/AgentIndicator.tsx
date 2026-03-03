'use client';

import { useState, useEffect, useCallback } from 'react';
import { CaretDown, Robot, Plus } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAccomplish } from '@/lib/accomplish';
import { cn } from '@/lib/utils';

interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  created_at: string;
}

const DEFAULT_DISPLAY_NAME = 'Omnibot';

function agentDisplayName(agent: Agent): string {
  return agent.id === 'default' ? DEFAULT_DISPLAY_NAME : agent.name;
}

interface AgentIndicatorProps {
  onOpenSettings: () => void;
  className?: string;
}

export function AgentIndicator({ onOpenSettings, className }: AgentIndicatorProps) {
  const accomplish = getAccomplish();
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string>('default');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, currentId] = await Promise.all([
        accomplish.listAgents?.() ?? [],
        accomplish.getSelectedAgentId?.() ?? 'default',
      ]);
      setAgents(list as Agent[]);
      setSelectedId(currentId as string);
    } catch {
      // silent — keep previous state
    } finally {
      setLoading(false);
    }
  }, [accomplish]);

  // Initial load + poll every 3 s (catches external changes from Settings panel)
  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 3000);
    return () => clearInterval(interval);
  }, [load]);

  // Reload when dropdown opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) void load();
      setOpen(isOpen);
    },
    [load],
  );

  const handleSelect = useCallback(
    async (id: string) => {
      setOpen(false);
      try {
        await accomplish.selectAgent?.(id);
        setSelectedId(id);
      } catch (err) {
        console.error('[AgentIndicator] selectAgent failed', err);
      }
    },
    [accomplish],
  );

  const handleCreateAgent = useCallback(() => {
    setOpen(false);
    onOpenSettings();
  }, [onOpenSettings]);

  const selectedAgent = agents.find((a) => a.id === selectedId);
  const displayName = selectedAgent ? agentDisplayName(selectedAgent) : DEFAULT_DISPLAY_NAME;

  if (loading) {
    return (
      <div className={cn('flex items-center gap-1 px-1 animate-pulse', className)}>
        <div className="w-14 h-4 rounded bg-muted-foreground/10" />
      </div>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md transition-all duration-150',
            'hover:bg-black/[0.04] dark:hover:bg-white/[0.08] focus:outline-none',
            className,
          )}
          data-testid="agent-indicator-trigger"
        >
          <Robot className="w-3.5 h-3.5 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[13px] font-medium text-foreground/80">{displayName}</span>
          <CaretDown
            className={cn(
              'w-3 h-3 flex-shrink-0 transition-transform duration-150 text-muted-foreground/60',
              open && 'rotate-180',
            )}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-44 shadow-lg">
        {/* Agent list */}
        {agents.map((agent) => {
          const isSelected = agent.id === selectedId;
          return (
            <DropdownMenuItem
              key={agent.id}
              onClick={() => handleSelect(agent.id)}
              className={cn(
                'gap-2 px-3 py-2 cursor-pointer',
                isSelected && 'font-medium text-foreground',
              )}
            >
              <span className="flex-1 text-sm truncate">{agentDisplayName(agent)}</span>
              {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        {/* Create agent */}
        <DropdownMenuItem
          onClick={handleCreateAgent}
          className="gap-2 px-3 py-2 cursor-pointer text-muted-foreground"
        >
          <Plus className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-sm">Create Agent</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
