import { describe, it, expect } from "bun:test";
import { formatContext } from "./context";
import type { Node, Episode, Fact } from "../types/graphiti";

describe("formatContext", () => {
  describe("empty inputs", () => {
    it("returns empty string when all inputs are empty", () => {
      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });
      expect(result).toBe("");
    });

    it("returns empty string when only profile is provided but empty", () => {
      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });
      expect(result).toBe("");
    });
  });

  describe("header", () => {
    it("includes [GRAPHITI] header when there is content", () => {
      const episode: Episode = {
        uuid: "ep1",
        name: "Test Episode",
        content: "Test content",
        source: "test",
        source_description: "Test source",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [episode],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("[GRAPHITI]");
      expect(result).not.toContain("[SUPERMEMORY]");
    });
  });

  describe("profile section", () => {
    it("includes User Profile section when profile nodes exist", () => {
      const profileNode: Node = {
        uuid: "node1",
        name: "User Preference",
        labels: ["Preference"],
        summary: "Prefers concise responses",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "profile-group",
      };

      const result = formatContext({
        profile: [profileNode],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("User Profile:");
      expect(result).toContain("Prefers concise responses");
    });

    it("formats multiple profile nodes", () => {
      const nodes: Node[] = [
        {
          uuid: "node1",
          name: "Preference 1",
          labels: ["Preference"],
          summary: "Prefers TypeScript",
          created_at: "2025-01-28T00:00:00Z",
          group_id: "profile-group",
        },
        {
          uuid: "node2",
          name: "Preference 2",
          labels: ["Preference"],
          summary: "Expert in React",
          created_at: "2025-01-28T00:00:00Z",
          group_id: "profile-group",
        },
      ];

      const result = formatContext({
        profile: nodes,
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("Prefers TypeScript");
      expect(result).toContain("Expert in React");
    });

    it("does not include User Profile section when profile is empty", () => {
      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).not.toContain("User Profile:");
    });

    it("uses node summary for profile content", () => {
      const profileNode: Node = {
        uuid: "node1",
        name: "User Preference",
        labels: ["Preference"],
        summary: "Custom summary text",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "profile-group",
      };

      const result = formatContext({
        profile: [profileNode],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("Custom summary text");
    });
  });

  describe("project knowledge section", () => {
    it("includes Project Knowledge section when episodes exist", () => {
      const episode: Episode = {
        uuid: "ep1",
        name: "Build Config",
        content: "Uses Bun, not Node.js",
        source: "docs",
        source_description: "Documentation",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [episode],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("Project Knowledge:");
      expect(result).toContain("Uses Bun, not Node.js");
    });

    it("formats multiple episodes", () => {
      const episodes: Episode[] = [
        {
          uuid: "ep1",
          name: "Build Config",
          content: "Uses Bun, not Node.js",
          source: "docs",
          source_description: "Documentation",
          created_at: "2025-01-28T00:00:00Z",
          group_id: "group1",
        },
        {
          uuid: "ep2",
          name: "Build Failure",
          content: "Build fails if .env.local missing",
          source: "error",
          source_description: "Error log",
          created_at: "2025-01-28T00:00:00Z",
          group_id: "group1",
        },
      ];

      const result = formatContext({
        profile: [],
        projectEpisodes: episodes,
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("Uses Bun, not Node.js");
      expect(result).toContain("Build fails if .env.local missing");
    });

    it("does NOT include similarity percentages", () => {
      const episode: Episode = {
        uuid: "ep1",
        name: "Build Config",
        content: "Uses Bun, not Node.js",
        source: "docs",
        source_description: "Documentation",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [episode],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).not.toContain("%");
      expect(result).not.toContain("[100%]");
      expect(result).not.toContain("[82%]");
    });

    it("uses episode content for project knowledge", () => {
      const episode: Episode = {
        uuid: "ep1",
        name: "Build Config",
        content: "Custom episode content here",
        source: "docs",
        source_description: "Documentation",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [episode],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("Custom episode content here");
    });
  });

  describe("relevant memories section", () => {
    it("includes Relevant Memories section when nodes exist", () => {
      const node: Node = {
        uuid: "node1",
        name: "Memory",
        labels: ["Memory"],
        summary: "Important memory content",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [node],
        relevantFacts: [],
      });

      expect(result).toContain("Relevant Memories:");
      expect(result).toContain("Important memory content");
    });

    it("includes Relevant Memories section when facts exist", () => {
      const fact: Fact = {
        uuid: "fact1",
        fact: "Important fact",
        source_node_uuid: "node1",
        target_node_uuid: "node2",
        created_at: "2025-01-28T00:00:00Z",
        expired_at: null,
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [fact],
      });

      expect(result).toContain("Relevant Memories:");
      expect(result).toContain("Important fact");
    });

    it("formats both nodes and facts in Relevant Memories", () => {
      const node: Node = {
        uuid: "node1",
        name: "Memory",
        labels: ["Memory"],
        summary: "Node memory",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const fact: Fact = {
        uuid: "fact1",
        fact: "Fact memory",
        source_node_uuid: "node1",
        target_node_uuid: "node2",
        created_at: "2025-01-28T00:00:00Z",
        expired_at: null,
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [node],
        relevantFacts: [fact],
      });

      expect(result).toContain("Node memory");
      expect(result).toContain("Fact memory");
    });

    it("does NOT include similarity percentages in relevant memories", () => {
      const node: Node = {
        uuid: "node1",
        name: "Memory",
        labels: ["Memory"],
        summary: "Important memory",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [node],
        relevantFacts: [],
      });

      expect(result).not.toContain("%");
    });

    it("does not include Relevant Memories section when both nodes and facts are empty", () => {
      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).not.toContain("Relevant Memories:");
    });
  });

  describe("section ordering", () => {
    it("orders sections: [GRAPHITI], User Profile, Project Knowledge, Relevant Memories", () => {
      const profileNode: Node = {
        uuid: "node1",
        name: "Preference",
        labels: ["Preference"],
        summary: "User preference",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "profile-group",
      };

      const episode: Episode = {
        uuid: "ep1",
        name: "Episode",
        content: "Episode content",
        source: "docs",
        source_description: "Documentation",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const memoryNode: Node = {
        uuid: "node2",
        name: "Memory",
        labels: ["Memory"],
        summary: "Memory content",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [profileNode],
        projectEpisodes: [episode],
        relevantNodes: [memoryNode],
        relevantFacts: [],
      });

      const headerIndex = result.indexOf("[GRAPHITI]");
      const profileIndex = result.indexOf("User Profile:");
      const projectIndex = result.indexOf("Project Knowledge:");
      const relevantIndex = result.indexOf("Relevant Memories:");

      expect(headerIndex).toBeLessThan(profileIndex);
      expect(profileIndex).toBeLessThan(projectIndex);
      expect(projectIndex).toBeLessThan(relevantIndex);
    });
  });

  describe("formatting details", () => {
    it("uses bullet points for list items", () => {
      const node: Node = {
        uuid: "node1",
        name: "Memory",
        labels: ["Memory"],
        summary: "Memory content",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [node],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("- Memory content");
    });

    it("separates sections with newlines", () => {
      const profileNode: Node = {
        uuid: "node1",
        name: "Preference",
        labels: ["Preference"],
        summary: "User preference",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "profile-group",
      };

      const episode: Episode = {
        uuid: "ep1",
        name: "Episode",
        content: "Episode content",
        source: "docs",
        source_description: "Documentation",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [profileNode],
        projectEpisodes: [episode],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("\n");
    });
  });

  describe("edge cases", () => {
    it("handles nodes with empty summary", () => {
      const node: Node = {
        uuid: "node1",
        name: "Memory",
        labels: ["Memory"],
        summary: "",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [node],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("User Profile:");
      expect(result).toContain("- ");
    });

    it("handles episodes with empty content", () => {
      const episode: Episode = {
        uuid: "ep1",
        name: "Episode",
        content: "",
        source: "docs",
        source_description: "Documentation",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [episode],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("Project Knowledge:");
      expect(result).toContain("- ");
    });

    it("handles facts with empty fact text", () => {
      const fact: Fact = {
        uuid: "fact1",
        fact: "",
        source_node_uuid: "node1",
        target_node_uuid: "node2",
        created_at: "2025-01-28T00:00:00Z",
        expired_at: null,
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [fact],
      });

      expect(result).toContain("Relevant Memories:");
      expect(result).toContain("- ");
    });

    it("handles nodes with attributes", () => {
      const node: Node = {
        uuid: "node1",
        name: "Memory",
        labels: ["Memory"],
        summary: "Memory with attributes",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
        attributes: { key: "value", nested: { prop: 123 } },
      };

      const result = formatContext({
        profile: [node],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("Memory with attributes");
    });

    it("handles nodes with multiple labels", () => {
      const node: Node = {
        uuid: "node1",
        name: "Memory",
        labels: ["Memory", "Important", "Archived"],
        summary: "Multi-label memory",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [node],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [],
      });

      expect(result).toContain("Multi-label memory");
    });

    it("handles facts with expired_at set", () => {
      const fact: Fact = {
        uuid: "fact1",
        fact: "Expired fact",
        source_node_uuid: "node1",
        target_node_uuid: "node2",
        created_at: "2025-01-28T00:00:00Z",
        expired_at: "2025-02-28T00:00:00Z",
        group_id: "group1",
      };

      const result = formatContext({
        profile: [],
        projectEpisodes: [],
        relevantNodes: [],
        relevantFacts: [fact],
      });

      expect(result).toContain("Expired fact");
    });
  });

  describe("integration", () => {
    it("formats complete context with all sections", () => {
      const profileNode: Node = {
        uuid: "node1",
        name: "Preference",
        labels: ["Preference"],
        summary: "Prefers concise responses",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "profile-group",
      };

      const episode: Episode = {
        uuid: "ep1",
        name: "Build Config",
        content: "Uses Bun, not Node.js",
        source: "docs",
        source_description: "Documentation",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const memoryNode: Node = {
        uuid: "node2",
        name: "Memory",
        labels: ["Memory"],
        summary: "Build fails if .env.local missing",
        created_at: "2025-01-28T00:00:00Z",
        group_id: "group1",
      };

      const fact: Fact = {
        uuid: "fact1",
        fact: "Important fact about the project",
        source_node_uuid: "node1",
        target_node_uuid: "node2",
        created_at: "2025-01-28T00:00:00Z",
        expired_at: null,
        group_id: "group1",
      };

      const result = formatContext({
        profile: [profileNode],
        projectEpisodes: [episode],
        relevantNodes: [memoryNode],
        relevantFacts: [fact],
      });

      expect(result).toContain("[GRAPHITI]");
      expect(result).toContain("User Profile:");
      expect(result).toContain("Prefers concise responses");
      expect(result).toContain("Project Knowledge:");
      expect(result).toContain("Uses Bun, not Node.js");
      expect(result).toContain("Relevant Memories:");
      expect(result).toContain("Build fails if .env.local missing");
      expect(result).toContain("Important fact about the project");
      expect(result).not.toContain("%");
    });
  });
});
