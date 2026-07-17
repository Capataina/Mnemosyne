"use client";

import {
  CheckIcon,
  ChevronsUpDownIcon,
  PlusCircleIcon,
  Trash2Icon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tag } from "@/types";
import { useEffect, useMemo, useState } from "react";

interface TagDropdownProps {
  tags?: Tag[] | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  selected: number[];
  setSelected: (vals: number[]) => void;
  placeholder: string;
  instruction: string;
  onCreateTag: (name: string, color: string) => Promise<Tag>;
  onDeleteTag?: (tagId: number) => void;
  imageId?: number;
  onAssignTag: (imageId: number, tagId: number) => void;
  onRemoveTag: (imageId: number, tagId: number) => void;
}

export function TagDropdown(props: TagDropdownProps) {
  const [input, setInput] = useState("");
  // Two-click inline delete arming, keyed by tag id. A modal confirm Dialog
  // cannot be used here: this dropdown is a `modal` Radix Popover, and a
  // modal popover blocks pointer events to anything outside its own content
  // — including the App-level confirm Dialog — so the confirm button's click
  // was silently swallowed (the "delete does nothing" bug). An inline
  // arm-then-confirm (same pattern as the settings reset controls) has no
  // second modal layer to race, so it always fires.
  const [armedDeleteId, setArmedDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (props.open === false) {
      setInput("");
      setArmedDeleteId(null);
    }
  }, [props.open]);

  // Filter tags based on input
  const filtered = useMemo(() => {
    if (!props.tags) return [];
    return props.tags.filter((t) =>
      t.name.toLowerCase().includes(input.toLowerCase())
    );
  }, [props.tags, input]);

  // Check if input exactly matches an existing tag
  const exactMatch = useMemo(() => {
    if (!props.tags || !input.trim()) return null;
    return props.tags.find(
      (t) => t.name.toLowerCase() === input.trim().toLowerCase()
    );
  }, [props.tags, input]);

  // Show create option when there's input and no exact match
  const showCreateOption = input.trim() && !exactMatch;

  const handleCreateTag = async () => {
    if (!input.trim() || !props.imageId) return;
    const newTag = await props.onCreateTag(input.trim(), "#3B82F6");
    if (newTag) {
      props.onAssignTag(props.imageId, newTag.id);
      props.setSelected([...props.selected, newTag.id]);
    }
    setInput("");
  };

  const handleSelectTag = (tag: Tag) => {
    if (!props.imageId) return;
    const wasSelected = props.selected.includes(tag.id);
    if (wasSelected) {
      props.onRemoveTag(props.imageId, tag.id);
      props.setSelected(props.selected.filter((id) => id !== tag.id));
    } else {
      props.onAssignTag(props.imageId, tag.id);
      props.setSelected([...props.selected, tag.id]);
    }
    setInput("");
  };

  return (
    <Popover open={props.open} onOpenChange={props.setOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
        variant="outline"
        role="combobox"
        aria-expanded={props.open}
        className="w-full justify-between bg-surface-raised/60"
      >
          <span>Add tags</span>
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
      </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[200] w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={input}
            onValueChange={setInput}
            placeholder="Search or create tag..."
          />
          <CommandList>
            {/* Create new tag option */}
            {showCreateOption && (
              <>
                <CommandGroup>
                  <CommandItem
                    value={`create-${input}`}
                    onSelect={handleCreateTag}
                    className="cursor-pointer"
                  >
                    <PlusCircleIcon className="mr-1 h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                    <span>
                      Create "<span className="font-medium">{input.trim()}</span>"
                    </span>
                  </CommandItem>
                </CommandGroup>
                {filtered.length > 0 && <CommandSeparator />}
              </>
            )}

            {/* Existing tags */}
            {filtered.length > 0 ? (
              <CommandGroup heading={showCreateOption ? "Existing tags" : undefined}>
                {filtered.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.id.toString()}
                    onSelect={() => handleSelectTag(tag)}
                    className="group flex cursor-pointer items-center"
                  >
                    <CheckIcon
                      className={cn(
                        "mr-1 h-4 w-4 shrink-0 text-primary transition-opacity",
                        props.selected.includes(tag.id)
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span className="flex-1 truncate">{tag.name}</span>
                    {props.onDeleteTag &&
                      (armedDeleteId === tag.id ? (
                        <button
                          type="button"
                          title={`Confirm delete "${tag.name}" from every image`}
                          aria-label={`Confirm delete tag ${tag.name}`}
                          className="ml-2 grid h-7 shrink-0 place-items-center rounded-lg border border-destructive/55 bg-destructive/10 px-2 text-[10px] font-[650] uppercase tracking-wide text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Second click confirms. Delete first (before the
                            // popover unmounts this row), then close.
                            props.onDeleteTag!(tag.id);
                            setArmedDeleteId(null);
                            props.setOpen(false);
                          }}
                          onMouseLeave={() => setArmedDeleteId(null)}
                        >
                          Delete?
                        </button>
                      ) : (
                        <button
                          type="button"
                          title={`Delete tag "${tag.name}" from every image`}
                          aria-label={`Delete tag ${tag.name}`}
                          className="ml-2 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 transition-[opacity,color,background-color] group-hover:opacity-65 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                          onClick={(e) => {
                            // stopPropagation so the row's onSelect (toggle)
                            // doesn't fire when the trash icon is clicked. First
                            // click arms; a second click on the armed control
                            // confirms. No modal confirm Dialog — this dropdown
                            // is a modal Popover and would swallow the dialog's
                            // click (see armedDeleteId note above).
                            e.stopPropagation();
                            setArmedDeleteId(tag.id);
                          }}
                        >
                          <Trash2Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                      ))}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              !showCreateOption && (
                <CommandEmpty>
                  {props.tags && props.tags.length > 0
                    ? "No tags found"
                    : "Type to create your first tag"}
                </CommandEmpty>
              )
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
