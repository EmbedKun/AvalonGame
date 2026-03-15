# -*- coding: utf-8 -*-
"""Turtle Soup game implemented with agentscope."""
import re
from typing import Any

from agentscope.agent import AgentBase
from agentscope.message import Msg
from agentscope.pipeline import MsgHub

from loguru import logger

from games.games.turtle_soup.engine import TurtleSoupConfig
from games.agents.echo_agent import EchoAgent


class TurtleSoupGame:
    """Main Turtle Soup game class."""

    def __init__(
        self,
        agents: list[AgentBase],
        config: TurtleSoupConfig,
        log_dir: str | None = None,
        language: str = "zh",
        observe_agent: AgentBase | None = None,
        state_manager: Any = None,
    ):
        self.agents = agents
        self.config = config
        self.log_dir = log_dir
        self.language = language
        self.observe_agent = observe_agent
        self.state_manager = state_manager

        # Moderator for system announcements
        self.moderator = EchoAgent()
        self.moderator.set_console_output_enabled(True)

        # Load prompts
        if language in ("zh", "cn"):
            from games.games.turtle_soup.prompt import ChinesePrompts as Prompts
        else:
            from games.games.turtle_soup.prompt import EnglishPrompts as Prompts
        self.Prompts = Prompts

        self.soup_master = agents[config.soup_master_id]
        self.guessers = [a for i, a in enumerate(agents) if i != config.soup_master_id]
        self.guesser_ids = [i for i in range(len(agents)) if i != config.soup_master_id]

        assert len(agents) >= 2, "Turtle Soup needs at least 2 players (1 master + 1 guesser)."

    def _get_hub_participants(self) -> list[AgentBase]:
        participants = self.agents.copy()
        if self.observe_agent is not None:
            participants.append(self.observe_agent)
        return participants

    def _is_correct(self, answer_content: str) -> bool:
        """Check if the soup master's answer indicates the guesser got it right."""
        content = answer_content.strip().lower()
        correct_markers_zh = ["正确", "恭喜", "猜到了", "真相"]
        correct_markers_en = ["correct", "congratulations", "found the truth"]
        markers = correct_markers_zh + correct_markers_en
        return any(m in content for m in markers)

    async def run(self) -> dict:
        """Run the Turtle Soup game. Returns result dict."""
        solved = False
        solver_id = None

        try:
            # --- Phase 0: Setup - assign roles and announce puzzle ---
            if self.state_manager:
                self.state_manager.update_game_state(
                    phase=0, round_id=0, status="running",
                    soup_master_id=self.config.soup_master_id,
                )
                await self.state_manager.broadcast_message(
                    self.state_manager.format_game_state()
                )

            async with MsgHub(participants=self._get_hub_participants()) as hub:
                # Send private system prompt to soup master (with truth)
                master_sys = self.Prompts.soup_master_system.format(
                    surface=self.config.puzzle_surface,
                    truth=self.config.puzzle_truth,
                )
                master_role_msg = Msg(
                    name="Moderator",
                    content=f"[Player{self.config.soup_master_id} ONLY] {master_sys}",
                    role="assistant",
                )
                await self.soup_master.observe(master_role_msg)

                # Send system prompt to each guesser
                for gid in self.guesser_ids:
                    guesser_sys_msg = Msg(
                        name="Moderator",
                        content=f"[Player{gid} ONLY] {self.Prompts.guesser_system}",
                        role="assistant",
                    )
                    await self.agents[gid].observe(guesser_sys_msg)

                # Broadcast the puzzle surface to everyone
                surface_text = self.Prompts.surface_announcement.format(
                    title=self.config.puzzle_title,
                    surface=self.config.puzzle_surface,
                )
                surface_msg = await self.moderator(surface_text)
                await hub.broadcast(surface_msg)

                # --- Phase 1: Q&A Loop ---
                for round_num in range(1, self.config.max_rounds + 1):
                    if self.state_manager:
                        if self.state_manager.should_stop:
                            logger.info("Game stopped by user")
                            break
                        self.state_manager.update_game_state(
                            phase=1, round_id=round_num
                        )
                        await self.state_manager.broadcast_message(
                            self.state_manager.format_game_state()
                        )

                    # Round announcement
                    round_text = self.Prompts.round_announcement.format(
                        round_num=round_num,
                        max_rounds=self.config.max_rounds,
                    )
                    round_msg = await self.moderator(round_text)
                    await hub.broadcast(round_msg)

                    # Each guesser asks a question
                    for gid_idx, gid in enumerate(self.guesser_ids):
                        if self.state_manager and self.state_manager.should_stop:
                            break

                        guesser = self.agents[gid]

                        # Prompt guesser to ask
                        question_prompt = await self.moderator(
                            self.Prompts.question_prompt
                        )
                        question_msg = await guesser(question_prompt)
                        await hub.broadcast(question_msg)

                        # Prompt soup master to answer
                        answer_prompt = await self.moderator(
                            self.Prompts.answer_prompt
                        )
                        answer_msg = await self.soup_master(answer_prompt)
                        await hub.broadcast(answer_msg)

                        # Check if puzzle is solved
                        if self._is_correct(answer_msg.content):
                            solved = True
                            solver_id = gid
                            break

                    if solved:
                        break
                    if self.state_manager and self.state_manager.should_stop:
                        break

                # --- Phase 2: Result ---
                if self.state_manager:
                    self.state_manager.update_game_state(phase=2)

                if solved:
                    result_text = self.Prompts.game_solved.format(
                        truth=self.config.puzzle_truth
                    )
                elif self.state_manager and self.state_manager.should_stop:
                    result_text = self.Prompts.truth_reveal.format(
                        truth=self.config.puzzle_truth
                    )
                else:
                    result_text = self.Prompts.game_timeout.format(
                        truth=self.config.puzzle_truth
                    )

                result_msg = await self.moderator(result_text)
                await hub.broadcast(result_msg)

            logger.info(f"Turtle Soup finished. Solved: {solved}")
            return {"solved": solved, "solver_id": solver_id}

        except InterruptedError:
            logger.info("Game was force-stopped")
            return {"solved": False, "solver_id": None, "stopped": True}
        except Exception as e:
            logger.error(f"Game error: {e}")
            raise


async def turtle_soup_game(
    agents: list[AgentBase],
    config: TurtleSoupConfig,
    log_dir: str | None = None,
    language: str = "zh",
    observe_agent: AgentBase | None = None,
    state_manager: Any = None,
) -> dict:
    """Convenience function to run Turtle Soup game."""
    game = TurtleSoupGame(
        agents=agents,
        config=config,
        log_dir=log_dir,
        language=language,
        observe_agent=observe_agent,
        state_manager=state_manager,
    )
    return await game.run()
