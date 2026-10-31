import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  PlaneUnavailableError,
  type PlaneMember,
  type PlanePriority,
  type PlaneProjectMetadata,
  type PlaneState,
  type PlaneTask,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { XIcon } from "lucide-react";
import { useId, useState } from "react";

import { planeEnvironment } from "~/state/plane";
import { useAtomCommand } from "~/state/use-atom-command";
import { planeConnectionErrorMessage } from "~/components/settings/PlaneConnectionSettings.logic";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { PlaneHtmlEditor } from "./PlaneHtmlEditor";
import { planePriorityLabel } from "./planeTaskList.logic";
import {
  buildPlaneTaskCreatePayload,
  buildPlaneTaskUpdatePayload,
  createPlaneTaskDraft,
  planeTaskDraftIsDirty,
  planeTaskDraftNameError,
  type PlaneTaskDraft,
} from "./planeTaskDraft";

/** Sentinel for "this task has no state". It is never sent to Plane. */
const NO_STATE = "__no_state__";

const TASK_PRIORITIES: ReadonlyArray<PlanePriority> = ["urgent", "high", "medium", "low", "none"];

const isPlaneTimeout = Schema.is(PlaneUnavailableError);

interface TaskWriteFailure {
  readonly message: string;
  /** A write that timed out may still have landed in Plane, so the outcome is unknown. */
  readonly timedOut: boolean;
}

export interface PlaneTaskEditorProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  /** The task to edit. A null task creates a new one. */
  readonly task: PlaneTask | null;
  readonly metadata: PlaneProjectMetadata;
  /** The saved task, new or updated, so the parent can select and refresh it. */
  readonly onSaved: (task: PlaneTask) => void;
  /** The parent closes the editor. Unsaved edits ask for a discard first. */
  readonly onCancel: () => void;
  /** Reports unsaved edits from user input, so the parent can guard closing or switching. */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Reports a write in flight, so the parent can refuse to dismiss the editor. */
  readonly onPendingChange?: (pending: boolean) => void;
}

/**
 * Create or edit one Plane task.
 *
 * The draft the editor opened with stays the baseline of every comparison, so a background
 * refetch never rewrites what the user typed and an untouched description never travels back
 * to Plane. The parent remounts the editor when the selected task changes.
 */
export function PlaneTaskEditor(props: PlaneTaskEditorProps) {
  const {
    environmentId,
    projectId,
    task,
    metadata,
    onSaved,
    onCancel,
    onDirtyChange,
    onPendingChange,
  } = props;
  const [baseline, setBaseline] = useState<PlaneTaskDraft>(() => createPlaneTaskDraft(task));
  const [draft, setDraft] = useState<PlaneTaskDraft>(() => createPlaneTaskDraft(task));
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<TaskWriteFailure | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const titleId = useId();

  const canCreate = useAtomValue(planeEnvironment.createTask.permissionAtom(environmentId));
  const canUpdate = useAtomValue(planeEnvironment.updateTask.permissionAtom(environmentId));
  const canWrite = task === null ? canCreate : canUpdate;
  const disabled = saving || !canWrite;
  const dirty = planeTaskDraftIsDirty(draft, baseline);

  const createTask = useAtomCommand(planeEnvironment.createTask, { reportFailure: false });
  const updateTask = useAtomCommand(planeEnvironment.updateTask, { reportFailure: false });

  const applyDraft = (next: PlaneTaskDraft) => {
    setDraft(next);
    onDirtyChange?.(planeTaskDraftIsDirty(next, baseline));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const missingName = planeTaskDraftNameError(draft);
    if (missingName !== null) {
      setNameError(missingName);
      return;
    }
    setNameError(null);
    setSaving(true);
    setFailure(null);
    onPendingChange?.(true);
    const sent = draft;
    const result =
      task === null
        ? await createTask({
            environmentId,
            input: buildPlaneTaskCreatePayload({ projectId, draft }),
          })
        : await updateTask({
            environmentId,
            input: buildPlaneTaskUpdatePayload({
              projectId,
              taskId: task.id,
              baseline,
              draft,
            }),
          });
    setSaving(false);
    onPendingChange?.(false);
    if (result._tag === "Failure") {
      // The draft stays as it is, so the user can fix the problem and send it again.
      const error = squashAtomCommandFailure(result);
      setFailure({
        message: planeConnectionErrorMessage(error),
        timedOut: isPlaneTimeout(error) && error.reason === "timeout",
      });
      return;
    }
    setBaseline(sent);
    onDirtyChange?.(false);
    onSaved(result.value);
  };

  const handleCancel = () => {
    if (saving) return;
    if (planeTaskDraftIsDirty(draft, baseline)) {
      setConfirmingDiscard(true);
      return;
    }
    onDirtyChange?.(false);
    onCancel();
  };

  const handleDiscard = () => {
    if (saving) return;
    setConfirmingDiscard(false);
    onDirtyChange?.(false);
    onCancel();
  };

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={titleId}>Title</Label>
          <Input
            id={titleId}
            value={draft.name}
            disabled={disabled}
            placeholder="Task title"
            onChange={(event) => {
              setNameError(null);
              applyDraft({ ...draft, name: event.currentTarget.value });
            }}
          />
          {nameError === null ? null : <p className="text-xs text-destructive">{nameError}</p>}
        </div>

        <PlaneHtmlEditor
          value={draft.descriptionHtml}
          disabled={disabled}
          label="Description"
          placeholder="Add a description"
          onChange={(descriptionHtml) => applyDraft({ ...draft, descriptionHtml })}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <PlanePrioritySelect
            value={draft.priority}
            disabled={disabled}
            onChange={(priority) => applyDraft({ ...draft, priority })}
          />
          <PlaneStateSelect
            value={draft.stateId}
            states={metadata.states}
            disabled={disabled}
            onChange={(stateId) => applyDraft({ ...draft, stateId })}
          />
        </div>

        <PlaneAssigneeField
          members={metadata.members}
          assigneeIds={draft.assigneeIds}
          disabled={disabled}
          onChange={(assigneeIds) => applyDraft({ ...draft, assigneeIds })}
        />

        {canWrite ? null : (
          <Alert variant="warning">
            <AlertTitle>This connection cannot write tasks</AlertTitle>
            <AlertDescription>
              The environment did not grant the tasks permission, so saving is unavailable.
            </AlertDescription>
          </Alert>
        )}

        {failure === null ? null : (
          <Alert variant="error">
            <AlertTitle>
              {task === null ? "Creating the task failed" : "Saving the task failed"}
            </AlertTitle>
            <AlertDescription>
              {failure.message}
              {failure.timedOut ? (
                <span>
                  Plane did not answer in time. The change may still be in Plane, so check before
                  trying again.
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
        <Button disabled={saving} variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
        <Button disabled={disabled || (task !== null && !dirty)} type="submit">
          {saving ? <Spinner /> : null}
          {task === null ? "Create task" : "Save changes"}
        </Button>
      </div>

      <AlertDialog open={confirmingDiscard} onOpenChange={setConfirmingDiscard}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This task has edits that were not saved to Plane. Discarding them cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Keep editing</AlertDialogClose>
            <Button variant="destructive" onClick={handleDiscard}>
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </form>
  );
}

function PlanePrioritySelect({
  value,
  disabled,
  onChange,
}: {
  readonly value: PlanePriority;
  readonly disabled: boolean;
  readonly onChange: (priority: PlanePriority) => void;
}) {
  const labelId = useId();
  const items: Record<string, string> = {};
  for (const priority of TASK_PRIORITIES) items[priority] = planePriorityLabel(priority);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={labelId}>Priority</Label>
      <Select
        items={items}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next as PlanePriority);
        }}
      >
        <SelectTrigger id={labelId} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {TASK_PRIORITIES.map((priority) => (
            <SelectItem key={priority} value={priority}>
              {planePriorityLabel(priority)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

function PlaneStateSelect({
  value,
  states,
  disabled,
  onChange,
}: {
  readonly value: string | null;
  readonly states: ReadonlyArray<PlaneState>;
  readonly disabled: boolean;
  readonly onChange: (stateId: string | null) => void;
}) {
  const labelId = useId();
  const options: Array<{ readonly value: string; readonly label: string }> = states.map(
    (state) => ({
      value: state.id,
      label: state.name,
    }),
  );
  // A state the project metadata does not list stays selectable, so it is not lost.
  if (value !== null && !options.some((option) => option.value === value)) {
    options.push({ value, label: "Current state" });
  }
  // A task that already has a state keeps it: the contract cannot express a cleared state.
  if (value === null) options.unshift({ value: NO_STATE, label: "No state" });

  const items: Record<string, string> = {};
  for (const option of options) items[option.value] = option.label;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={labelId}>State</Label>
      <Select
        items={items}
        value={value ?? NO_STATE}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          onChange(next === NO_STATE ? null : next);
        }}
      >
        <SelectTrigger id={labelId} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

function PlaneAssigneeField({
  members,
  assigneeIds,
  disabled,
  onChange,
}: {
  readonly members: ReadonlyArray<PlaneMember>;
  readonly assigneeIds: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly onChange: (assigneeIds: ReadonlyArray<string>) => void;
}) {
  const groupId = useId();
  const knownIds = new Set(members.map((member) => member.id));
  const unknownIds = assigneeIds.filter((id) => !knownIds.has(id));

  const toggleMember = (memberId: string, checked: boolean) => {
    if (checked) {
      if (assigneeIds.includes(memberId)) return;
      onChange([...assigneeIds, memberId]);
      return;
    }
    onChange(assigneeIds.filter((id) => id !== memberId));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label id={groupId} render={<span />}>
        Assignees
      </Label>
      <div aria-labelledby={groupId} role="group" className="flex flex-col gap-1">
        {members.length === 0 && unknownIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">This project lists no members to assign.</p>
        ) : null}
        {members.map((member) => (
          <label key={member.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={assigneeIds.includes(member.id)}
              disabled={disabled}
              onCheckedChange={(checked) => toggleMember(member.id, checked === true)}
            />
            <span className="min-w-0 truncate">{member.displayName ?? member.id}</span>
          </label>
        ))}
        {unknownIds.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              Assigned to people this project does not list. They stay assigned until removed.
            </p>
            {unknownIds.map((id) => (
              <div key={id} className="flex items-center gap-2">
                <Badge variant="secondary">{id}</Badge>
                <Button
                  aria-label={`Remove ${id}`}
                  disabled={disabled}
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onChange(assigneeIds.filter((assigneeId) => assigneeId !== id))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
