import { toolTarget } from "./folds.ts";

export interface ToolTitle {
  key: string;
  params: Record<string, string | number>;
}

export function toolTitle(toolName: string, argumentsJson: string): ToolTitle {
  const name = toolName.trim().toLowerCase();
  const target = toolTarget(argumentsJson);
  if (name === "bash" || name === "shell") {
    return titled("Run a command", "Run command {target}", target);
  }
  if (name === "read_file") {
    return titled("Read a file", "Read file {target}", target);
  }
  if (name === "write_file") {
    return titled("Write a file", "Write file {target}", target);
  }
  if (name === "edit_file") {
    return titled("Edit a file", "Edit file {target}", target);
  }
  if (name === "apply_patch") {
    return titled("Apply a patch", "Edit file {target}", target);
  }
  if (name === "glob") {
    return titled("Find files", "Find files {target}", target);
  }
  if (name === "grep") {
    return titled("Search in files", "Search files for {target}", target);
  }
  if (name === "web_fetch") {
    return titled("Fetch a web page", "Fetch {target}", target);
  }
  if (name === "web_search") {
    return titled("Search the web", "Search the web for {target}", target);
  }
  if (name === "send_file") {
    return titled("Deliver a file", "Deliver file {target}", target);
  }
  return { key: "", params: {} };
}

function titled(generic: string, specific: string, target: string): ToolTitle {
  return target
    ? { key: specific, params: { target } }
    : { key: generic, params: {} };
}
