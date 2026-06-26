// tests/integration/scene-engine.test.ts
// Integration test: scene_manage — activate → present_choices → commit_choice
// Covers: activate, present_choices, commit_choice, brief, render_pov, get_history

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockContext } from '../unit/mocks';
import { handle_scene_manage } from '../../src/tools/scene-manage';

const SCENE_KEY = 'scene:tavern-intro';
const ENTITY_KEY = 'character:hero';
const LOCATION_KEY = 'location:tavern';

const SCENE_TEXT = `**Title:** The Rusty Flagon
**Description:** You enter a dimly lit tavern.
**NPC-Present:** Bartender, Drunkard
**Choices:**
- Talk to the bartender
- Confront the drunkard
- Order a drink`;

const ENTITY_TEXT = `**Name:** Hero
**Role:** adventurer
**Species:** Human
**Location:** location:tavern`;

const LOCATION_TEXT = `**Name:** The Rusty Flagon
**Type:** tavern
**Occupants:** character:hero`;

function callScene(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  return handle_scene_manage({
    c: ctx,
    id: 'test-id',
    isAuthenticated: true,
    args,
  });
}

async function jsonBody(res: Response): Promise<any> {
  expect(res.status).toBe(200);
  return res.json();
}

describe('Scene engine integration', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext({
      [SCENE_KEY]: JSON.stringify({ text: SCENE_TEXT, meta: { version: 1 } }),
      [ENTITY_KEY]: JSON.stringify({ text: ENTITY_TEXT, meta: { version: 1 } }),
      [LOCATION_KEY]: JSON.stringify({ text: LOCATION_TEXT, meta: { version: 1 } }),
    });
  });

  describe('Activate → Present → Commit cycle', () => {
    it('activates a scene, presents choices, and commits one', async () => {
      // 1. ACTIVATE
      const activateRes = await callScene(ctx, {
        action: 'activate',
        scene_key: SCENE_KEY,
      });
      const activateBody = await jsonBody(activateRes);
      expect(activateBody.result).toBeDefined();

      // 2. PRESENT_CHOICES
      const presentRes = await callScene(ctx, {
        action: 'present_choices',
        scene_key: SCENE_KEY,
        entity_key: ENTITY_KEY,
      });
      const presentBody = await jsonBody(presentRes);
      expect(presentBody.result).toBeDefined();
      
      const choices = presentBody.result.choices || presentBody.result.valid_choices || [];
      if (choices.length > 0) {
        // 3. COMMIT_CHOICE (use first available)
        const choiceId = choices[0].id || choices[0].choice_id || choices[0];
        const commitRes = await callScene(ctx, {
          action: 'commit_choice',
          choice_id: typeof choiceId === 'string' ? choiceId : String(choiceId),
          entity_key: ENTITY_KEY,
        });
        const commitBody = await jsonBody(commitRes);
        expect(commitBody.result).toBeDefined();
        expect(commitBody.error).toBeUndefined();
      }
    });

    it('errors on commit_choice with invalid choice_id', async () => {
      const commitRes = await callScene(ctx, {
        action: 'commit_choice',
        choice_id: 'nonexistent-choice-99999',
        entity_key: ENTITY_KEY,
      });
      const commitBody = await jsonBody(commitRes);
      // Should return an error for invalid choice
      expect(commitBody.error || commitBody.result?.error).toBeTruthy();
    });
  });

  describe('Scene brief', () => {
    it('returns a brief for a location', async () => {
      const briefRes = await callScene(ctx, {
        action: 'brief',
        location_key: LOCATION_KEY,
        include: {
          events: 3,
          open_setups: true,
          relationships: true,
          sensory: true,
        },
      });
      const briefBody = await jsonBody(briefRes);
      expect(briefBody.result).toBeDefined();
    });

    it('returns a brief for a scene', async () => {
      const briefRes = await callScene(ctx, {
        action: 'brief',
        scene_key: SCENE_KEY,
        include: {
          events: 1,
          open_setups: false,
          relationships: false,
          sensory: true,
        },
      });
      const briefBody = await jsonBody(briefRes);
      expect(briefBody.result).toBeDefined();
    });
  });

  describe('Render POV', () => {
    it('renders a scene from entity perspective', async () => {
      const povRes = await callScene(ctx, {
        action: 'render_pov',
        pov_entity_key: ENTITY_KEY,
        location_key: LOCATION_KEY,
        include_voice_hints: true,
        reveal_threshold: 0.5,
      });
      const povBody = await jsonBody(povRes);
      expect(povBody.result).toBeDefined();
    });
  });

  describe('Choice history', () => {
    it('gets an entity choice history', async () => {
      const historyRes = await callScene(ctx, {
        action: 'get_history',
        entity_key: ENTITY_KEY,
      });
      const historyBody = await jsonBody(historyRes);
      expect(historyBody.result).toBeDefined();
    });
  });
});
