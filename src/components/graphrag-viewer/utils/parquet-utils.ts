/**
 * Parquet 文件读取工具
 * 移植自 graphrag-visualizer 项目
 */

import type { ParquetReadOptions } from "hyparquet";
import type { FileSchema } from "../models/types";

let parquetReadPromise: Promise<typeof import("hyparquet")["parquetRead"]> | null = null;

const loadParquetRead = () => {
  if (!parquetReadPromise) {
    parquetReadPromise = import("hyparquet").then((module) => module.parquetRead);
  }

  return parquetReadPromise;
};

/**
 * 异步缓冲区类，用于 hyparquet 读取
 */
export class AsyncBuffer {
  private buffer: ArrayBuffer;
  public byteLength: number;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.byteLength = buffer.byteLength;
  }

  async slice(start: number, end: number): Promise<ArrayBuffer> {
    return this.buffer.slice(start, end);
  }
}

/**
 * 解析数值类型
 */
const parseValue = (value: any, type: "number" | "bigint"): any => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.endsWith("n")) {
    return BigInt(value.slice(0, -1));
  }
  return type === "bigint" ? BigInt(value) : Number(value);
};

/**
 * 读取 Parquet 文件
 */
export const readParquetFile = async (
  file: File | Blob,
  schema?: FileSchema
): Promise<any[]> => {
  try {
    const parquetRead = await loadParquetRead();
    const arrayBuffer = await file.arrayBuffer();
    const asyncBuffer = new AsyncBuffer(arrayBuffer);

    return new Promise((resolve, reject) => {
      const options: ParquetReadOptions = {
        file: asyncBuffer,
        rowFormat: "object",
        onComplete: (rows: Record<string, any>[]) => {
          if (schema === "entity") {
            resolve(
              rows.map((row) => ({
                id: row["id"],
                human_readable_id: parseValue(row["human_readable_id"], "number"),
                title: row["title"],
                type: row["type"],
                description: row["description"],
                text_unit_ids: row["text_unit_ids"],
              }))
            );
          } else if (schema === "relationship") {
            resolve(
              rows.map((row) => ({
                id: row["id"],
                human_readable_id: parseValue(row["human_readable_id"], "number"),
                source: row["source"],
                target: row["target"],
                description: row["description"],
                weight: row["weight"],
                combined_degree: parseValue(row["combined_degree"], "number"),
                text_unit_ids: row["text_unit_ids"],
                type: "RELATED",
              }))
            );
          } else if (schema === "document") {
            resolve(
              rows.map((row) => ({
                id: row["id"],
                human_readable_id: parseValue(row["human_readable_id"], "number"),
                title: row["title"],
                text: row["text"],
                text_unit_ids: row["text_unit_ids"],
              }))
            );
          } else if (schema === "text_unit") {
            resolve(
              rows.map((row) => ({
                id: row["id"],
                human_readable_id: parseValue(row["human_readable_id"], "number"),
                text: row["text"],
                n_tokens: parseValue(row["n_tokens"], "number"),
                document_ids: row["document_ids"],
                entity_ids: row["entity_ids"],
                relationship_ids: row["relationship_ids"],
              }))
            );
          } else if (schema === "community") {
            resolve(
              rows.map((row) => ({
                id: row["id"],
                human_readable_id: parseValue(row["human_readable_id"], "number"),
                community: parseValue(row["community"], "number"),
                parent: parseValue(row["parent"], "number"),
                level: parseValue(row["level"], "number"),
                title: row["title"],
                entity_ids: row["entity_ids"],
                relationship_ids: row["relationship_ids"],
                text_unit_ids: row["text_unit_ids"],
                period: row["period"],
                size: parseValue(row["size"], "number"),
              }))
            );
          } else if (schema === "community_report") {
            resolve(
              rows.map((row) => ({
                id: row["id"],
                human_readable_id: parseValue(row["human_readable_id"], "number"),
                community: parseValue(row["community"], "number"),
                parent: parseValue(row["parent"], "number"),
                level: parseValue(row["level"], "number"),
                title: row["title"],
                summary: row["summary"],
                full_content: row["full_content"],
                rank: row["rank"],
                rank_explanation: row["rank_explanation"],
                findings: row["findings"],
                full_content_json: row["full_content_json"],
                period: row["period"],
                size: parseValue(row["size"], "number"),
              }))
            );
          } else if (schema === "covariate") {
            resolve(
              rows.map((row) => ({
                id: row["id"],
                human_readable_id: parseValue(row["human_readable_id"], "number"),
                covariate_type: row["covariate_type"],
                type: row["type"],
                description: row["description"],
                subject_id: row["subject_id"],
                object_id: row["object_id"],
                status: row["status"],
                start_date: row["start_date"],
                end_date: row["end_date"],
                source_text: row["source_text"],
                text_unit_id: row["text_unit_id"],
              }))
            );
          } else {
            resolve(rows.map((row) => ({ ...row })));
          }
        },
      };
      parquetRead(options).catch(reject);
    });
  } catch (err) {
    console.error("Error reading Parquet file", err);
    return [];
  }
};

/**
 * 从文件名获取 schema
 */
export const getSchemaFromFileName = (fileName: string): FileSchema | undefined => {
  const baseMapping: Record<string, FileSchema> = {
    "entities.parquet": "entity",
    "relationships.parquet": "relationship",
    "documents.parquet": "document",
    "text_units.parquet": "text_unit",
    "communities.parquet": "community",
    "community_reports.parquet": "community_report",
    "covariates.parquet": "covariate",
  };

  // 检查完整文件名
  if (baseMapping[fileName]) {
    return baseMapping[fileName];
  }

  // 检查 create_final_ 前缀
  if (fileName.startsWith("create_final_")) {
    const baseName = fileName.replace("create_final_", "");
    if (baseMapping[baseName]) {
      return baseMapping[baseName];
    }
  }

  return undefined;
};

/**
 * 从 URL 加载 Parquet 文件
 */
export const loadParquetFromUrl = async (
  url: string,
  schema?: FileSchema
): Promise<any[]> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to load ${url}: ${response.status}`);
      return [];
    }
    const buffer = await response.arrayBuffer();
    const blob = new Blob([buffer], { type: "application/x-parquet" });
    const fileName = url.split("/").pop() || "unknown.parquet";
    const file = new File([blob], fileName);
    return readParquetFile(file, schema);
  } catch (err) {
    console.error(`Error loading parquet from ${url}:`, err);
    return [];
  }
};
