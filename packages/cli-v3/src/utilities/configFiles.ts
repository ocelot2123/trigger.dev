import { Config, ResolvedConfig } from "@trigger.dev/core/v3";
import { findUp } from "find-up";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import xdgAppPaths from "xdg-app-paths";
import { z } from "zod";
import { CLOUD_API_URL, CONFIG_FILES } from "../consts.js";
import { readJSONFileSync } from "./fileSystem.js";
import { logger } from "./logger.js";
import { findTriggerDirectories, resolveTriggerDirectories } from "./taskFiles.js";

function getGlobalConfigFolderPath() {
  const configDir = xdgAppPaths("trigger").config();

  return configDir;
}

//auth config file
export const UserAuthConfigSchema = z.object({
  accessToken: z.string().optional(),
  apiUrl: z.string().optional(),
});

export type UserAuthConfig = z.infer<typeof UserAuthConfigSchema>;

const UserAuthConfigFileSchema = z.record(UserAuthConfigSchema);

type UserAuthConfigFile = z.infer<typeof UserAuthConfigFileSchema>;

function getAuthConfigFilePath() {
  return path.join(getGlobalConfigFolderPath(), "default.json");
}

export function writeAuthConfigProfile(config: UserAuthConfig, profile: string = "default") {
  const existingConfig = readAuthConfigFile() || {};

  existingConfig[profile] = config;

  writeAuthConfigFile(existingConfig);
}

export function readAuthConfigProfile(profile: string = "default"): UserAuthConfig | undefined {
  try {
    const authConfigFilePath = getAuthConfigFilePath();

    logger.debug(`Reading auth config file`, { authConfigFilePath });

    const json = readJSONFileSync(authConfigFilePath);
    const parsed = UserAuthConfigFileSchema.parse(json);
    return parsed[profile];
  } catch (error) {
    logger.debug(`Error reading auth config file: ${error}`);
    return undefined;
  }
}

function readAuthConfigFile(): UserAuthConfigFile | undefined {
  try {
    const authConfigFilePath = getAuthConfigFilePath();

    logger.debug(`Reading auth config file`, { authConfigFilePath });

    const json = readJSONFileSync(authConfigFilePath);
    const parsed = UserAuthConfigFileSchema.parse(json);
    return parsed;
  } catch (error) {
    logger.debug(`Error reading auth config file: ${error}`);
    return undefined;
  }
}

function writeAuthConfigFile(config: UserAuthConfigFile) {
  const authConfigFilePath = getAuthConfigFilePath();
  mkdirSync(path.dirname(authConfigFilePath), {
    recursive: true,
  });
  writeFileSync(path.join(authConfigFilePath), JSON.stringify(config), {
    encoding: "utf-8",
  });
}

async function getConfigPath(dir: string, fileName?: string): Promise<string | undefined> {
  return await findUp(fileName ? [fileName] : CONFIG_FILES, { cwd: dir });
}

export type ReadConfigOptions = {
  projectRef?: string;
  configFile?: string;
};

export type ReadConfigResult =
  | {
    status: "file";
    config: ResolvedConfig;
    path: string;
  }
  | {
    status: "in-memory";
    config: ResolvedConfig;
  };

export async function readConfig(
  dir: string,
  options?: ReadConfigOptions
): Promise<ReadConfigResult> {
  const absoluteDir = path.resolve(process.cwd(), dir);

  logger.debug("Searching for the config file", {
    dir,
    options,
    absoluteDir,
  });

  const configPath = await getConfigPath(dir, options?.configFile);

  if (!configPath) {
    if (options?.projectRef) {
      const rawConfig = await normalizeConfig({ project: options.projectRef });
      const config = Config.parse(rawConfig);

      return {
        status: "in-memory",
        config: await resolveConfig(absoluteDir, config),
      };
    } else {
      throw new Error(`Config file not found in ${absoluteDir} or any parent directory.`);
    }
  }

  // import the config file
  const userConfigModule = await import(`${pathToFileURL(configPath).href}?_ts=${Date.now()}`);
  const rawConfig = await normalizeConfig(userConfigModule ? userConfigModule.default : {});
  const config = Config.parse(rawConfig);

  return {
    status: "file",
    config: await resolveConfig(absoluteDir, config),
    path: configPath,
  };
}

export async function resolveConfig(path: string, config: Config): Promise<ResolvedConfig> {
  if (!config.triggerDirectories) {
    config.triggerDirectories = await findTriggerDirectories(path);
  }

  config.triggerDirectories = resolveTriggerDirectories(config.triggerDirectories);

  if (!config.triggerUrl) {
    config.triggerUrl = CLOUD_API_URL;
  }

  if (!config.projectDir) {
    config.projectDir = path;
  }

  return config as ResolvedConfig;
}

export async function normalizeConfig(config: any): Promise<any> {
  if (typeof config === "function") {
    config = config();
  }

  return await config;
}
