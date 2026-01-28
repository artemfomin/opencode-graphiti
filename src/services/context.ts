import type { Node, Episode, Fact } from "../types/graphiti.js";

interface FormatContextInput {
  profile: Node[];
  projectEpisodes: Episode[];
  relevantNodes: Node[];
  relevantFacts: Fact[];
}

export function formatContext(input: FormatContextInput): string {
  const parts: string[] = ["[GRAPHITI]"];

  // User Profile section
  if (input.profile.length > 0) {
    parts.push("\nUser Profile:");
    input.profile.forEach((node) => {
      parts.push(`- ${node.summary}`);
    });
  }

  // Project Knowledge section
  if (input.projectEpisodes.length > 0) {
    parts.push("\nProject Knowledge:");
    input.projectEpisodes.forEach((episode) => {
      parts.push(`- ${episode.content}`);
    });
  }

  // Relevant Memories section
  if (input.relevantNodes.length > 0 || input.relevantFacts.length > 0) {
    parts.push("\nRelevant Memories:");
    input.relevantNodes.forEach((node) => {
      parts.push(`- ${node.summary}`);
    });
    input.relevantFacts.forEach((fact) => {
      parts.push(`- ${fact.fact}`);
    });
  }

  if (parts.length === 1) {
    return "";
  }

  return parts.join("\n");
}
