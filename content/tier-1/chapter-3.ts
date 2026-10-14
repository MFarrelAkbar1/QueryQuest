import type { ChapterInput } from "../schema";

export const chapter3: ChapterInput = {
  id: "t1-c3",
  title: "Combining Conditions",
  summary: "Ask sharper questions by combining conditions with AND, OR and NOT.",
  bonusXp: 50,
  challenges: [
    {
      id: "t1-c3-01",
      title: "Cheap thrills",
      difficulty: "medium",
      objective: "Require two conditions at once with AND.",
      concept:
        "**AND** combines two conditions; a row is kept only if **both** are true:\n\n```sql\nSELECT title FROM games WHERE platform = 'PC' AND rating > 8;\n```",
      problem: "Find budget action games: return `title` and `price` of games in the `Action` genre that cost **less than 30**.",
      datasetId: "arcade",
      statementType: "select",
      starterSql: "SELECT title, price\nFROM games\nWHERE ",
      hints: [
        "There are two conditions: one on genre, one on price.",
        "Join the two conditions with AND.",
        "`... WHERE genre = 'Action' AND price < 30;`",
      ],
      solution: {
        sql: "SELECT title, price FROM games WHERE genre = 'Action' AND price < 30;",
        explanation: "A row passes only if it is an Action game *and* its price is under 30. Shadow Circuit is Action but costs 59.99, so it is excluded.",
      },
      expected: {
        columns: ["title", "price"],
        rows: [
          ["Pixel Raiders", "19.99"],
          ["Robo Rumble", "0.00"],
        ],
        ordered: false,
      },
    },
    {
      id: "t1-c3-02",
      title: "Brain teasers",
      difficulty: "medium",
      objective: "Accept either of two conditions with OR.",
      concept:
        "**OR** keeps a row if **at least one** of the conditions is true:\n\n```sql\nSELECT title FROM games WHERE platform = 'PC' OR platform = 'Console';\n```",
      problem: "A player loves thinking games. Return `title` and `genre` of every game whose genre is `Puzzle` **or** `Strategy`.",
      datasetId: "arcade",
      statementType: "select",
      starterSql: "SELECT title, genre\nFROM games\nWHERE ",
      hints: [
        "A game can't be both genres at once, so AND would return nothing.",
        "Write two complete comparisons joined by OR.",
        "`... WHERE genre = 'Puzzle' OR genre = 'Strategy';`",
      ],
      solution: {
        sql: "SELECT title, genre FROM games WHERE genre = 'Puzzle' OR genre = 'Strategy';",
        explanation:
          "Each side of OR must be a full comparison: `genre = 'Puzzle' OR 'Strategy'` would not work. A row is kept when either comparison is true.",
      },
      expected: {
        columns: ["title", "genre"],
        rows: [
          ["Dungeon Logic", "Puzzle"],
          ["Word Weaver", "Puzzle"],
          ["Starbound Tactics", "Strategy"],
          ["Castle Builder", "Strategy"],
          ["Block Quest", "Puzzle"],
        ],
        ordered: false,
      },
    },
    {
      id: "t1-c3-03",
      title: "Fast and furious, off mobile",
      difficulty: "hard",
      objective: "Combine AND, OR and NOT correctly using parentheses.",
      concept:
        "**NOT** flips a condition: `NOT platform = 'Mobile'` is true for every non-mobile game.\n\nWhen mixing AND and OR, MySQL evaluates **AND before OR**, just like multiplication before addition. Use **parentheses** to group conditions the way you mean them:\n\n```sql\nWHERE (a OR b) AND NOT c\n```",
      problem:
        "Return `title` and `genre` of every game that is in the `Racing` **or** `Action` genre **and** is **not** on `Mobile`. Use `NOT` for the platform condition.",
      datasetId: "arcade",
      statementType: "select",
      starterSql: "SELECT title, genre\nFROM games\nWHERE ",
      hints: [
        "Without parentheses, AND binds tighter than OR, which changes the meaning.",
        "Group the two genre checks together in parentheses.",
        "`... WHERE (genre = 'Racing' OR genre = 'Action') AND NOT platform = 'Mobile';`",
      ],
      solution: {
        sql: "SELECT title, genre FROM games WHERE (genre = 'Racing' OR genre = 'Action') AND NOT platform = 'Mobile';",
        explanation:
          "The parentheses make the genre check one unit, which then must be true *together with* `NOT platform = 'Mobile'`. Without them, `genre = 'Racing' OR (genre = 'Action' AND NOT platform = 'Mobile')` would also let mobile racing games through.",
      },
      expected: {
        columns: ["title", "genre"],
        rows: [
          ["Pixel Raiders", "Action"],
          ["Galaxy Drift", "Racing"],
          ["Shadow Circuit", "Action"],
          ["Turbo Kart Arena", "Racing"],
          ["Desert Rally", "Racing"],
        ],
        ordered: false,
      },
    },
  ],
};
