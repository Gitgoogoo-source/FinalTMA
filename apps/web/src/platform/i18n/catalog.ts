import {
  englishGameContent,
  englishGameContentById,
} from "@evomypet/api-contracts/localization";

import { englishCopy } from "./en.ts";
import { simplifiedChineseErrorCopy } from "./zh-error-copy.ts";
import { englishErrorCopy } from "./error-copy.ts";

export const loadedEnglishCatalog = {
  copy: englishCopy,
  errors: englishErrorCopy,
  chineseErrors: simplifiedChineseErrorCopy,
  gameContent: englishGameContent,
  gameContentById: englishGameContentById,
} as const;
