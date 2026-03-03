import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { settingsVariants, settingsTransitions } from '@/lib/animations';
import { getAccomplish } from '@/lib/accomplish';
import { Trash, PencilSimple, Check, X, UserCircle } from '@phosphor-icons/react';

interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  created_at: string;
}

export function AgentsPanel() {
  const accomplish = getAccomplish();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string>('default');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create-form state
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, currentId] = await Promise.all([
        accomplish.listAgents?.() ?? [],
        accomplish.getSelectedAgentId?.() ?? 'default',
      ]);
      setAgents(list as Agent[]);
      setSelectedId(currentId as string);
    } catch (err) {
      console.error('[AgentsPanel] load error', err);
    } finally {
      setLoading(false);
    }
  }, [accomplish]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelect = useCallback(
    async (id: string) => {
      try {
        await accomplish.selectAgent?.(id);
        setSelectedId(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to select agent.');
      }
    },
    [accomplish],
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      const agent = (await accomplish.createAgent?.({
        name,
        system_prompt: newPrompt.trim(),
      })) as Agent;
      setAgents((prev) => [...prev, agent]);
      setNewName('');
      setNewPrompt('');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent.');
    } finally {
      setSaving(false);
    }
  }, [accomplish, newName, newPrompt]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (id === 'default') return;
      setError(null);
      try {
        await accomplish.deleteAgent?.(id);
        setAgents((prev) => prev.filter((a) => a.id !== id));
        if (selectedId === id) {
          setSelectedId('default');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete agent.');
      }
    },
    [accomplish, selectedId],
  );

  const startEdit = useCallback((agent: Agent) => {
    setEditingId(agent.id);
    setEditName(agent.name);
    setEditPrompt(agent.system_prompt);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    setEditSaving(true);
    setError(null);
    try {
      await accomplish.updateAgent?.(editingId, {
        name: editName.trim(),
        system_prompt: editPrompt.trim(),
      });
      setAgents((prev) =>
        prev.map((a) =>
          a.id === editingId
            ? { ...a, name: editName.trim(), system_prompt: editPrompt.trim() }
            : a,
        ),
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent.');
    } finally {
      setEditSaving(false);
    }
  }, [accomplish, editingId, editName, editPrompt]);

  if (loading) {
    return (
      <div className="flex h-[300px] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading agents…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Agents let you give the AI a custom persona and instructions. Select one before launching a
        task.
      </p>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            variants={settingsVariants.fadeSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={settingsTransitions.enter}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent list */}
      <div className="flex flex-col gap-2">
        <AnimatePresence mode="popLayout">
          {agents.map((agent) => {
            const isSelected = agent.id === selectedId;
            const isEditing = editingId === agent.id;

            return (
              <motion.div
                key={agent.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className={`rounded-lg border p-3 transition-colors ${
                  isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card'
                }`}
              >
                {isEditing ? (
                  /* Edit mode */
                  <div className="flex flex-col gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Agent name"
                      className="h-8 text-sm"
                      disabled={editSaving}
                    />
                    <textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      placeholder="System prompt / persona instructions…"
                      rows={4}
                      disabled={editSaving}
                      className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={cancelEdit}
                        disabled={editSaving}
                        className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <X size={12} />
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={editSaving || !editName.trim()}
                        className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {editSaving ? (
                          <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : (
                          <Check size={12} />
                        )}
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => handleSelect(agent.id)}
                      className="mt-0.5 flex-shrink-0"
                      title={isSelected ? 'Currently selected' : 'Select this agent'}
                    >
                      <UserCircle
                        size={20}
                        weight={isSelected ? 'fill' : 'regular'}
                        className={isSelected ? 'text-primary' : 'text-muted-foreground'}
                      />
                    </button>

                    <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{agent.name}</span>
                        {isSelected && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                            active
                          </span>
                        )}
                      </div>
                      {agent.system_prompt ? (
                        <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                          {agent.system_prompt}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          No custom instructions
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEdit(agent)}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        title="Edit agent"
                      >
                        <PencilSimple size={14} />
                      </button>
                      {agent.id !== 'default' && (
                        <button
                          onClick={() => handleDelete(agent.id)}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title="Delete agent"
                        >
                          <Trash size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* New agent form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            className="flex flex-col gap-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 p-3"
            variants={settingsVariants.fadeSlide}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={settingsTransitions.enter}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Agent name (e.g. Data Analyst)"
              className="h-8 text-sm"
              disabled={saving}
              autoFocus
            />
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="System prompt / persona instructions…"
              rows={4}
              disabled={saving}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowForm(false);
                  setNewName('');
                  setNewPrompt('');
                }}
                disabled={saving}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                <X size={12} />
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? (
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Check size={12} />
                )}
                Create
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Agent
        </button>
      )}
    </div>
  );
}
