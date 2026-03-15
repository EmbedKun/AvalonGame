# -*- coding: utf-8 -*-
"""Turtle Soup game configuration and state management."""
from dataclasses import dataclass, field
from typing import List, Optional
import random

from games.utils import load_config


@dataclass
class TurtleSoupConfig:
    """Configuration for Turtle Soup (lateral thinking puzzle) game."""
    num_players: int = 4
    max_rounds: int = 20
    language: str = "zh"
    puzzle_title: str = ""
    puzzle_surface: str = ""
    puzzle_truth: str = ""
    soup_master_id: int = 0
    seed: int = 42

    @classmethod
    def from_yaml(cls, yaml_path: str) -> "TurtleSoupConfig":
        """Load config from YAML file and select a random puzzle."""
        cfg = load_config(yaml_path)
        game_cfg = cfg.get("game", {})

        config = cls(
            num_players=game_cfg.get("num_players", 4),
            max_rounds=game_cfg.get("max_rounds", 20),
            language=game_cfg.get("language", "zh"),
            seed=game_cfg.get("seed", 42),
        )

        puzzles = game_cfg.get("puzzles", [])
        if puzzles:
            puzzle = random.choice(puzzles)
            config.puzzle_title = puzzle.get("title", "")
            config.puzzle_surface = puzzle.get("surface", "")
            config.puzzle_truth = puzzle.get("truth", "")

        return config
