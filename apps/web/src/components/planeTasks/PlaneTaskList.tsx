import {
  PLANE_DEFAULT_PER_PAGE,
  PLANE_MAX_SEARCH_RESULTS,
  type EnvironmentId,
  type PlanePriority,
  type PlaneProjectMetadata,
  type PlaneState,
  type PlaneTask,
  type PlaneTaskHit,
} from "@t3tools/contracts";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { planeEnvironment, usePlaneTaskPages } from "~/state/plane";
import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import {
  filterPlaneTasks,
  hasActivePlaneTaskFilters,
  mergePlaneTaskPages,
  nextPlaneListCursor,
  NO_PLANE_TASK_FILTERS,
  planeAssigneeNames,
  planePriorityLabel,
  planeSearchView,
  planeStateById,
  type PlaneTaskFilters,
} from "./planeTaskList.logic";

const SEARCH_DEBOUNCE_MS = 300;
const FILTER_ALL = "all";

/** First page first: the cursor state starts with one null entry meaning "no cursor yet". */
type PlaneListCursor = string | null;

export interface PlaneTaskListProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly projectIdentifier: string | null;
  readonly metadata: PlaneProjectMetadata | null;
  readonly selectedTaskId: string | null;
  readonly onSelectTask: (taskId: string) => void;
}

export function PlaneTaskList({
  environmentId,
  projectId,
  projectIdentifier,
  metadata,
  selectedTaskId,
  onSelectTask,
}: PlaneTaskListProps) {
  const [cursors, setCursors] = useState<Array<PlaneListCursor>>([null]);
  const [filters, setFilters] = useState<PlaneTaskFilters>(NO_PLANE_TASK_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // The debounce timer spreads keystrokes so each one does not issue a Plane search request.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer-driven debounce, not derived state
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchText]);

  const isSearching = debouncedSearch.length > 0;
  const taskPages = usePlaneTaskPages(
    environmentId,
    cursors.map((cursor) => ({
      projectId,
      perPage: PLANE_DEFAULT_PER_PAGE,
      ...(cursor === null ? {} : { cursor }),
    })),
  );
  const searchQuery = useEnvironmentQuery(
    isSearching
      ? planeEnvironment.search({
          environmentId,
          input: { projectId, query: debouncedSearch, limit: PLANE_MAX_SEARCH_RESULTS },
        })
      : null,
  );

  const pages = taskPages.results.map((result) =>
    result._tag === "Success" ? result.value : null,
  );
  const tasks = mergePlaneTaskPages(pages);
  const nextCursor = nextPlaneListCursor(pages[pages.length - 1]?.page ?? null);
  const firstPagePending = taskPages.results[0]?.waiting ?? false;
  const isLoadingMore = taskPages.results[cursors.length - 1]?.waiting ?? false;

  const visibleTasks = filterPlaneTasks(tasks, filters);
  const filtersActive = hasActivePlaneTaskFilters(filters);
  const searchHits =
    searchQuery.data === null ? null : planeSearchView(searchQuery.data, PLANE_MAX_SEARCH_RESULTS);

  const clearSearch = () => {
    if (searchText !== "") setSearchText("");
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <InputGroup className="min-w-0 flex-1 sm:max-w-xs">
          <InputGroupAddon>
            {searchQuery.isPending ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search tasks"
            onChange={(event) => setSearchText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") clearSearch();
            }}
            placeholder="Search tasks"
            value={searchText}
          />
        </InputGroup>
        {isSearching ? (
          <Button aria-label="Clear search" onClick={clearSearch} size="icon-sm" variant="ghost">
            <XIcon />
          </Button>
        ) : (
          <>
            <PlaneTaskFilterSelect
              ariaLabel="Filter by state"
              onChange={(stateId) => setFilters({ ...filters, stateId })}
              options={
                metadata?.states.map((state) => ({ value: state.id, label: state.name })) ?? []
              }
              placeholder="All states"
              value={filters.stateId ?? FILTER_ALL}
            />
            <PlaneTaskFilterSelect
              ariaLabel="Filter by priority"
              onChange={(priority) =>
                setFilters({
                  ...filters,
                  // The options above are exactly the priority union.
                  priority: (priority === FILTER_ALL ? null : priority) as PlanePriority | null,
                })
              }
              options={(["urgent", "high", "medium", "low", "none"] as const).map((priority) => ({
                value: priority,
                label: planePriorityLabel(priority),
              }))}
              placeholder="All priorities"
              value={filters.priority ?? FILTER_ALL}
            />
            <PlaneTaskFilterSelect
              ariaLabel="Filter by assignee"
              onChange={(assigneeId) => setFilters({ ...filters, assigneeId })}
              options={
                metadata?.members
                  .filter((member) => member.displayName !== null)
                  .map((member) => ({
                    value: member.id,
                    label: member.displayName ?? member.id,
                  })) ?? []
              }
              placeholder="All assignees"
              value={filters.assigneeId ?? FILTER_ALL}
            />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {filtersActive ? (
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              Filters apply to the {tasks.length} loaded tasks
            </span>
          ) : null}
          <Button
            aria-label="Refresh tasks"
            onClick={taskPages.refresh}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshIcon refreshing={taskPages.results.some((result) => result.waiting)} />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isSearching ? (
          <PlaneTaskSearchResults
            emptyText={
              searchHits !== null && searchHits.hits.length === 0
                ? `No tasks match “${debouncedSearch}”.`
                : null
            }
            error={searchQuery.error}
            hits={searchHits?.hits ?? null}
            isLoading={searchQuery.isPending}
            onRetry={searchQuery.refresh}
            onSelectTask={onSelectTask}
            selectedTaskId={selectedTaskId}
            truncated={searchHits?.truncated ?? false}
          />
        ) : firstPagePending && tasks.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <Spinner />
          </div>
        ) : taskPages.error !== null && tasks.length === 0 ? (
          <PlaneTaskListNotice
            action={<Button onClick={taskPages.refresh}>Retry</Button>}
            message={taskPages.error}
          />
        ) : tasks.length === 0 ? (
          <PlaneTaskListNotice message="No tasks in this project yet." />
        ) : visibleTasks.length === 0 ? (
          <PlaneTaskListNotice
            action={
              <Button onClick={() => setFilters(NO_PLANE_TASK_FILTERS)} variant="outline">
                Clear filters
              </Button>
            }
            message="None of the loaded tasks match the filters."
          />
        ) : (
          <>
            <ul aria-label="Tasks" className="py-1">
              {visibleTasks.map((task) => (
                <li key={task.id}>
                  <PlaneTaskRow
                    assigneeNames={planeAssigneeNames(metadata, task)}
                    identifier={projectIdentifier}
                    isSelected={task.id === selectedTaskId}
                    onSelect={() => onSelectTask(task.id)}
                    state={planeStateById(metadata, task.stateId)}
                    task={task}
                  />
                </li>
              ))}
            </ul>
            {nextCursor !== null ? (
              <div className="flex justify-center p-3">
                <Button
                  disabled={isLoadingMore}
                  onClick={() => setCursors([...cursors, nextCursor])}
                  size="sm"
                  variant="outline"
                >
                  {isLoadingMore ? <Spinner /> : null}
                  Load more tasks
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function PlaneTaskRow({
  task,
  state,
  assigneeNames,
  identifier,
  isSelected,
  onSelect,
}: {
  readonly task: PlaneTask;
  readonly state: PlaneState | null;
  readonly assigneeNames: Array<string>;
  readonly identifier: string | null;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent",
        isSelected && "bg-accent",
      )}
      onClick={onSelect}
    >
      {state?.color !== null && state?.color !== undefined ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: state.color }}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{task.name}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {task.priority !== "none" ? <span>{planePriorityLabel(task.priority)}</span> : null}
        {assigneeNames.length > 0 ? (
          <span className="max-w-32 truncate">{assigneeNames.join(", ")}</span>
        ) : null}
        <Badge variant="secondary">
          {identifier === null ? "" : `${identifier}-`}
          {task.sequenceId}
        </Badge>
      </span>
    </button>
  );
}

function PlaneTaskSearchResults({
  hits,
  isLoading,
  error,
  emptyText,
  truncated,
  selectedTaskId,
  onSelectTask,
  onRetry,
}: {
  readonly hits: ReadonlyArray<PlaneTaskHit> | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly emptyText: string | null;
  readonly truncated: boolean;
  readonly selectedTaskId: string | null;
  readonly onSelectTask: (taskId: string) => void;
  readonly onRetry: () => void;
}) {
  if (isLoading && hits === null) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner />
      </div>
    );
  }
  if (error !== null) {
    return (
      <PlaneTaskListNotice action={<Button onClick={onRetry}>Retry</Button>} message={error} />
    );
  }
  if (hits === null || hits.length === 0) {
    return <PlaneTaskListNotice message={emptyText ?? "No matching tasks."} />;
  }
  return (
    <div className="py-1">
      {truncated ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Showing the first {hits.length} matches
        </p>
      ) : null}
      <ul aria-label="Search results">
        {hits.map((hit) => (
          <li key={hit.id}>
            <button
              aria-current={hit.id === selectedTaskId ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent",
                hit.id === selectedTaskId && "bg-accent",
              )}
              onClick={() => onSelectTask(hit.id)}
            >
              <span className="min-w-0 flex-1 truncate">{hit.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {hit.projectIdentifier !== null ? <span>{hit.projectIdentifier}</span> : null}
                <Badge variant="secondary">{hit.sequenceId}</Badge>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Search covers task names, sequence numbers, and project identifiers.
      </p>
    </div>
  );
}

function PlaneTaskListNotice({
  message,
  action,
}: {
  readonly message: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

function PlaneTaskFilterSelect({
  value,
  options,
  placeholder,
  ariaLabel,
  onChange,
}: {
  readonly value: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly onChange: (value: string) => void;
}) {
  const items: Record<string, string> = { [FILTER_ALL]: placeholder };
  for (const option of options) items[option.value] = option.label;
  return (
    <Select
      items={items}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") onChange(nextValue);
      }}
      value={value}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-auto min-w-0" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={FILTER_ALL}>{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
