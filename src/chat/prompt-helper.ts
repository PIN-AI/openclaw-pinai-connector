/**
 * CLI Input Helper
 * Provides interactive prompts for CLI commands
 */

import * as readline from "node:readline";

/**
 * Prompt user for input
 */
export function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt user for confirmation (yes/no)
 */
export async function promptConfirm(question: string): Promise<boolean> {
  const answer = await promptInput(`${question} (yes/no): `);
  return answer.toLowerCase() === "yes" || answer.toLowerCase() === "y";
}
