import { describe, it, expect } from "bun:test";
import {
  GraphitiConfig,
  Episode,
  Node,
  Fact,
  isEpisode,
  isNode,
  isFact,
  isGraphitiConfig,
} from "./graphiti";

describe("GraphitiConfig", () => {
  it("should validate a complete config", () => {
    const config: GraphitiConfig = {
      graphitiUrl: "http://localhost:8000",
      groupId: "test-group",
      profileGroupId: "test-group_profile",
      maxMemories: 5,
      maxProjectMemories: 10,
      maxProfileItems: 5,
      injectProfile: true,
      keywordPatterns: ["remember", "save"],
      compactionThreshold: 0.8,
    };

    expect(isGraphitiConfig(config)).toBe(true);
  });

  it("should require graphitiUrl and groupId", () => {
    const invalidConfig = {
      profileGroupId: "test-group_profile",
    };

    expect(isGraphitiConfig(invalidConfig)).toBe(false);
  });

  it("should accept config with only required fields", () => {
    const minimalConfig: GraphitiConfig = {
      graphitiUrl: "http://localhost:8000",
      groupId: "test-group",
    };

    expect(isGraphitiConfig(minimalConfig)).toBe(true);
  });
});

describe("Episode", () => {
  it("should validate a valid episode", () => {
    const episode: Episode = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      name: "Test Episode",
      content: "This is test content",
      source: "test-source",
      source_description: "A test source",
      created_at: "2024-01-28T00:00:00Z",
      group_id: "test-group",
    };

    expect(isEpisode(episode)).toBe(true);
  });

  it("should reject episode with missing required fields", () => {
    const invalidEpisode = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      name: "Test Episode",
      // missing content, source, source_description, created_at, group_id
    };

    expect(isEpisode(invalidEpisode)).toBe(false);
  });

  it("should reject episode with wrong field types", () => {
    const invalidEpisode = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      name: "Test Episode",
      content: 123, // should be string
      source: "test-source",
      source_description: "A test source",
      created_at: "2024-01-28T00:00:00Z",
      group_id: "test-group",
    };

    expect(isEpisode(invalidEpisode)).toBe(false);
  });
});

describe("Node", () => {
  it("should validate a valid node", () => {
    const node: Node = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      name: "Test Node",
      labels: ["label1", "label2"],
      summary: "A test node",
      created_at: "2024-01-28T00:00:00Z",
      group_id: "test-group",
    };

    expect(isNode(node)).toBe(true);
  });

  it("should validate node with optional attributes", () => {
    const node: Node = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      name: "Test Node",
      labels: ["label1"],
      summary: "A test node",
      created_at: "2024-01-28T00:00:00Z",
      group_id: "test-group",
      attributes: { key: "value", nested: { prop: 123 } },
    };

    expect(isNode(node)).toBe(true);
  });

  it("should reject node with missing required fields", () => {
    const invalidNode = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      name: "Test Node",
      // missing labels, summary, created_at, group_id
    };

    expect(isNode(invalidNode)).toBe(false);
  });

  it("should reject node with wrong field types", () => {
    const invalidNode = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      name: "Test Node",
      labels: "not-an-array", // should be array
      summary: "A test node",
      created_at: "2024-01-28T00:00:00Z",
      group_id: "test-group",
    };

    expect(isNode(invalidNode)).toBe(false);
  });
});

describe("Fact", () => {
  it("should validate a valid fact", () => {
    const fact: Fact = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      fact: "Test fact content",
      source_node_uuid: "550e8400-e29b-41d4-a716-446655440001",
      target_node_uuid: "550e8400-e29b-41d4-a716-446655440002",
      created_at: "2024-01-28T00:00:00Z",
      expired_at: null,
      group_id: "test-group",
    };

    expect(isFact(fact)).toBe(true);
  });

  it("should validate fact with expired_at date", () => {
    const fact: Fact = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      fact: "Test fact content",
      source_node_uuid: "550e8400-e29b-41d4-a716-446655440001",
      target_node_uuid: "550e8400-e29b-41d4-a716-446655440002",
      created_at: "2024-01-28T00:00:00Z",
      expired_at: "2024-02-28T00:00:00Z",
      group_id: "test-group",
    };

    expect(isFact(fact)).toBe(true);
  });

  it("should reject fact with missing required fields", () => {
    const invalidFact = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      fact: "Test fact content",
      // missing source_node_uuid, target_node_uuid, created_at, expired_at, group_id
    };

    expect(isFact(invalidFact)).toBe(false);
  });

  it("should reject fact with wrong field types", () => {
    const invalidFact = {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      fact: 123, // should be string
      source_node_uuid: "550e8400-e29b-41d4-a716-446655440001",
      target_node_uuid: "550e8400-e29b-41d4-a716-446655440002",
      created_at: "2024-01-28T00:00:00Z",
      expired_at: null,
      group_id: "test-group",
    };

    expect(isFact(invalidFact)).toBe(false);
  });
});
