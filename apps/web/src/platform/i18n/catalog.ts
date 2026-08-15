import {
  englishGameContent,
  englishGameContentById,
} from "@pokepets/api-contracts/localization";

import { englishCopy } from "./en.ts";
import { englishErrorCopy } from "./error-copy.ts";

export const loadedEnglishCatalog = {
  copy: englishCopy,
  errors: englishErrorCopy,
  gameContent: englishGameContent,
  gameContentById: englishGameContentById,
} as const;
