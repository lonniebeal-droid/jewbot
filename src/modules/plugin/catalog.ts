/**
 * Compiled-in manifests. Discovery still loads the same files from disk.
 * If a folder fails to load, the copy here keeps the real module registered.
 */

import { jewbotModule as agent } from '../agent/manifest';
import { jewbotModule as cascade } from '../cascade/manifest';
import { jewbotModule as context } from '../context/manifest';
import { jewbotModule as echo } from '../echo/manifest';
import { jewbotModule as files } from '../files/manifest';
import { jewbotModule as fleetTriage } from '../fleet-triage/manifest';
import { jewbotModule as llm } from '../llm/manifest';
import { jewbotModule as muse } from '../muse/manifest';
import { jewbotModule as musicRelease } from '../music-release/manifest';
import { jewbotModule as portfolioSweeper } from '../portfolio-sweeper/manifest';
import { jewbotModule as safety } from '../safety/manifest';
import { jewbotModule as ssh } from '../ssh/manifest';
import { jewbotModule as streetTrader } from '../street-trader/manifest';
import { jewbotModule as terminal } from '../terminal/manifest';
import { jewbotModule as twinrent } from '../twinrent/manifest';
import type { JewbotModule } from './types';

export const builtinManifests: JewbotModule[] = [
  llm,
  agent,
  terminal,
  ssh,
  files,
  cascade,
  safety,
  context,
  muse,
  musicRelease,
  fleetTriage,
  streetTrader,
  twinrent,
  portfolioSweeper,
  echo,
];
