import type { DatasetInput } from "../schema";

/** A small indie game store. Used throughout Tier 1. All titles are fictional. */
export const arcade: DatasetInput = {
  id: "arcade",
  title: "Pixel Arcade store",
  description: "The catalogue of a small online game store.",
  tables: [
    {
      name: "games",
      description: "Every game the store sells.",
      columns: [
        { name: "id", type: "INT", primaryKey: true },
        { name: "title", type: "VARCHAR(60)" },
        { name: "genre", type: "VARCHAR(20)" },
        { name: "platform", type: "VARCHAR(20)", description: "PC, Console or Mobile" },
        { name: "release_year", type: "INT" },
        { name: "price", type: "DECIMAL(6,2)", description: "In US dollars; 0.00 means free to play" },
        { name: "rating", type: "DECIMAL(3,1)", description: "Average review score out of 10" },
        { name: "copies_sold", type: "INT" },
      ],
      rows: [
        [1, "Pixel Raiders", "Action", "PC", 2019, "19.99", "8.4", 120000],
        [2, "Galaxy Drift", "Racing", "Console", 2021, "49.99", "7.9", 340000],
        [3, "Dungeon Logic", "Puzzle", "PC", 2017, "9.99", "9.1", 85000],
        [4, "Farm Friends", "Simulation", "Mobile", 2020, "0.00", "6.8", 2100000],
        [5, "Shadow Circuit", "Action", "Console", 2022, "59.99", "8.9", 510000],
        [6, "Word Weaver", "Puzzle", "Mobile", 2018, "2.99", "7.2", 640000],
        [7, "Turbo Kart Arena", "Racing", "Console", 2016, "39.99", "8.1", 900000],
        [8, "Starbound Tactics", "Strategy", "PC", 2023, "29.99", "9.3", 75000],
        [9, "Castle Builder", "Strategy", "PC", 2015, "14.99", "7.5", 260000],
        [10, "Ocean Explorer", "Adventure", "Mobile", 2021, "4.99", "8.0", 430000],
        [11, "Mystic Grove", "Adventure", "PC", 2020, "24.99", "8.7", 150000],
        [12, "Neon Rhythm", "Music", "Console", 2019, "34.99", "7.7", 190000],
        [13, "Block Quest", "Puzzle", "Console", 2023, "19.99", "8.2", 98000],
        [14, "Sky Pilots", "Simulation", "PC", 2018, "44.99", "6.9", 55000],
        [15, "Robo Rumble", "Action", "Mobile", 2022, "0.00", "7.1", 1500000],
        [16, "Desert Rally", "Racing", "PC", 2020, "24.99", "7.4", 68000],
        [17, "Pocket Racer", "Racing", "Mobile", 2021, "0.00", "6.5", 880000],
      ],
    },
  ],
};
