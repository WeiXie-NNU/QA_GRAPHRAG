/**
 * 文件处理 Hook
 * 移植自 graphrag-visualizer 项目
 * 
 * 支持从指定路径加载 parquet 文件
 */

import { useState, useCallback } from "react";
import { readParquetFile, getSchemaFromFileName, loadParquetFromUrl } from "../utils/parquet-utils";
import type {
  Entity,
  Relationship,
  Document,
  TextUnit,
  Community,
  CommunityReport,
  Covariate,
} from "../models/types";

// 默认文件列表
const BASE_FILE_NAMES = [
  "entities.parquet",
  "relationships.parquet",
  "documents.parquet",
  "text_units.parquet",
  "communities.parquet",
  "community_reports.parquet",
  "covariates.parquet",
];

interface UseFileHandlerReturn {
  entities: Entity[];
  relationships: Relationship[];
  documents: Document[];
  textunits: TextUnit[];
  communities: Community[];
  communityReports: CommunityReport[];
  covariates: Covariate[];
  loading: boolean;
  error: string | null;
  handleFilesRead: (files: File[]) => Promise<void>;
  loadFromPath: (basePath: string) => Promise<void>;
  clearData: () => void;
}

const useFileHandler = (): UseFileHandlerReturn => {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [textunits, setTextUnits] = useState<TextUnit[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityReports, setCommunityReports] = useState<CommunityReport[]>([]);
  const [covariates, setCovariates] = useState<Covariate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 清空所有数据
   */
  const clearData = useCallback(() => {
    setEntities([]);
    setRelationships([]);
    setDocuments([]);
    setTextUnits([]);
    setCommunities([]);
    setCommunityReports([]);
    setCovariates([]);
    setError(null);
  }, []);

  /**
   * 处理多个文件
   */
  const loadFiles = async (files: Array<File | string>) => {
    const entitiesArray: Entity[][] = [];
    const relationshipsArray: Relationship[][] = [];
    const documentsArray: Document[][] = [];
    const textUnitsArray: TextUnit[][] = [];
    const communitiesArray: Community[][] = [];
    const communityReportsArray: CommunityReport[][] = [];
    const covariatesArray: Covariate[][] = [];

    for (const file of files) {
      const fileName = typeof file === "string" ? file.split("/").pop()! : file.name;
      const schema = getSchemaFromFileName(fileName);

      if (!schema) {
        console.warn(`[GraphRAG] Unknown file schema: ${fileName}`);
        continue;
      }

      let data: any[];
      try {
        if (typeof file === "string") {
          // 从 URL 加载
          data = await loadParquetFromUrl(file, schema);
        } else {
          // 从 File 对象加载
          data = await readParquetFile(file, schema);
        }

        if (!data || data.length === 0) {
          console.warn(`[GraphRAG] Empty data from: ${fileName}`);
          continue;
        }

        console.log(`[GraphRAG] Loaded ${fileName}: ${data.length} records`);

        switch (schema) {
          case "entity":
            entitiesArray.push(data);
            break;
          case "relationship":
            relationshipsArray.push(data);
            break;
          case "document":
            documentsArray.push(data);
            break;
          case "text_unit":
            textUnitsArray.push(data);
            break;
          case "community":
            communitiesArray.push(data);
            break;
          case "community_report":
            communityReportsArray.push(data);
            break;
          case "covariate":
            covariatesArray.push(data);
            break;
        }
      } catch (err) {
        console.warn(`[GraphRAG] Failed to load ${fileName}:`, err);
      }
    }

    // 合并所有数据
    setEntities(entitiesArray.flat());
    setRelationships(relationshipsArray.flat());
    setDocuments(documentsArray.flat());
    setTextUnits(textUnitsArray.flat());
    setCommunities(communitiesArray.flat());
    setCommunityReports(communityReportsArray.flat());
    setCovariates(covariatesArray.flat());
  };

  /**
   * 处理拖放的文件
   */
  const handleFilesRead = useCallback(async (files: File[]) => {
    setLoading(true);
    setError(null);

    try {
      await loadFiles(files);
    } catch (err) {
      console.error("[GraphRAG] Error handling files:", err);
      setError("文件处理失败，请检查文件格式");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 从指定路径加载文件
   */
  const loadFromPath = useCallback(async (basePath: string) => {
    setLoading(true);
    setError(null);
    clearData();

    try {
      // 首先尝试列出目录中的文件
      let filesToLoad: string[] = [];

      try {
        const listResponse = await fetch(`${basePath}/_list_files`);
        if (listResponse.ok) {
          const fileList = await listResponse.json();
          filesToLoad = fileList.files
            .filter((f: { name: string }) => f.name.endsWith(".parquet"))
            .map((f: { name: string }) => `${basePath}/${f.name}`);
          console.log(`[GraphRAG] Found ${filesToLoad.length} files via directory listing`);
        }
      } catch {
        console.log("[GraphRAG] Directory listing not available, using default file list");
      }

      // 如果目录列表不可用，使用默认文件名
      if (filesToLoad.length === 0) {
        filesToLoad = BASE_FILE_NAMES.map((name) => `${basePath}/${name}`);
      }

      // 检查文件是否存在并加载
      const existingFiles: string[] = [];
      for (const filePath of filesToLoad) {
        try {
          const response = await fetch(filePath, { method: "HEAD" });
          if (response.ok) {
            existingFiles.push(filePath);
          }
        } catch {
          // 文件不存在，跳过
        }
      }

      if (existingFiles.length === 0) {
        setError(`未找到可用的 parquet 文件: ${basePath}`);
        return;
      }

      console.log(`[GraphRAG] Loading ${existingFiles.length} files from ${basePath}`);
      await loadFiles(existingFiles);
    } catch (err) {
      console.error("[GraphRAG] Error loading from path:", err);
      setError(`加载失败: ${basePath}`);
    } finally {
      setLoading(false);
    }
  }, [clearData]);

  return {
    entities,
    relationships,
    documents,
    textunits,
    communities,
    communityReports,
    covariates,
    loading,
    error,
    handleFilesRead,
    loadFromPath,
    clearData,
  };
};

export default useFileHandler;
