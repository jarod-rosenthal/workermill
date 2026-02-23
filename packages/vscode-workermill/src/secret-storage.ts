/**
 * Secure API Key Storage — wraps VS Code's SecretStorage API.
 *
 * VS Code SecretStorage uses the OS native keychain (Keychain on macOS,
 * libsecret on Linux, Credential Manager on Windows) with no extra deps.
 */

import * as vscode from "vscode";

const API_KEY_KEY = "workermill.apiKey";
let _secrets: vscode.SecretStorage | null = null;

export function initSecretStorage(secrets: vscode.SecretStorage): void {
  _secrets = secrets;
}

export async function getApiKey(): Promise<string | undefined> {
  return _secrets?.get(API_KEY_KEY);
}

export async function storeApiKey(apiKey: string): Promise<void> {
  await _secrets?.store(API_KEY_KEY, apiKey);
}

export async function deleteApiKey(): Promise<void> {
  await _secrets?.delete(API_KEY_KEY);
}
