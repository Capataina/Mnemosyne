"use client";

import {
  CheckIcon,
  ChevronsUpDownIcon,
  PlusCircleIcon,
  Trash2Icon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
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
  const confirm = useConfirm();

  useEffect(() => {
    if (props.open === false) {
      setInput("");
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
                    {props.onDeleteTag && (
                      <button
                        type="button"
                        title={`Delete tag "${tag.name}" from catalog`}
                        aria-label={`Delete tag ${tag.name}`}
                        className="ml-2 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 transition-[opacity,color,background-color] group-hover:opacity-65 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                        onClick={async (e) => {
                          // stopPropagation so the row's onSelect (toggle)
                          // doesn't fire when the user clicks the trash icon
                          e.stopPropagation();
                          props.setOpen(false);
                          const confirmed = await confirm({
                            title: `Delete tag "${tag.name}"?`,
                            description:
                              "This removes the tag from every image that has it.",
                            confirmLabel: "Delete tag",
                            destructive: true,
                          });
                          if (confirmed) {
                            props.onDeleteTag!(tag.id);
                          }
                        }}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </button>
                    )}
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
