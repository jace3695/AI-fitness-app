'use client';
import { createContext, useContext } from 'react';
import type { CharacterControlProps } from './useCharacterStage';
export const CHARACTER_RESET_EVENT = 'yeoni-character-reset';
export type CharacterChannel = { publish(controls: CharacterControlProps): () => void; requestQuiet(): () => void };
export const CommonCharacterContext = createContext<CharacterChannel | null>(null);
export const useCommonCharacterHost = () => useContext(CommonCharacterContext);
