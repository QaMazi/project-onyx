export const audioTracks = [
  { id: "egyptian-1", name: "Egyptian 1", file: "/audio/Egyptian 1.mp3" },
  { id: "egyptian-2", name: "Egyptian 2", file: "/audio/Egyptian 2.mp3" },
  { id: "egyptian-3", name: "Egyptian 3", file: "/audio/Egyptian 3.mp3" },
  { id: "egyptian-4", name: "Egyptian 4", file: "/audio/Egyptian 4.mp3" },
  { id: "egyptian-5", name: "Egyptian 5", file: "/audio/Egyptian 5.mp3" },
  { id: "egyptian-6", name: "Egyptian 6", file: "/audio/Egyptian 6.mp3" },
  { id: "desert-of-set", name: "Desert Of Set", file: "/audio/Desert Of Set.mp3" },
  { id: "obelisk-of-thunder", name: "Obelisk of Thunder", file: "/audio/Obelisk of Thunder.mp3" },
  { id: "millennium-battle-1", name: "Millennium Battle 1", file: "/audio/Millennium Battle 1.mp3" },
  { id: "millennium-battle-2", name: "Millennium Battle 2", file: "/audio/Millennium Battle 2.mp3" },
  { id: "millennium-battle-3", name: "Millennium Battle 3", file: "/audio/Millennium Battle 3.mp3" },
  { id: "overlap", name: "Overlap", file: "/audio/Overlap.mp3" },
  { id: "shuffle", name: "Shuffle", file: "/audio/Shuffle.mp3" },
  { id: "wild-drive", name: "Wild Drive", file: "/audio/Wild Drive.mp3" },
  { id: "warriors", name: "Warriors", file: "/audio/Warriors.mp3" },
  { id: "voice", name: "Voice", file: "/audio/Voice.mp3" },
  { id: "eyes", name: "EYES", file: "/audio/EYES.mp3" },
  { id: "ano-hi-no-gogo", name: "Ano hi no Gogo", file: "/audio/Ano hi no Gogo.mp3" },
  {
    id: "afureru-kanjou-ga-tomaranai",
    name: "Afureru Kanjou ga Tomaranai",
    file: "/audio/Afureru Kanjou ga Tomaranai.mp3",
  },
  { id: "genki-no-shower", name: "Genki no Shower", file: "/audio/Genki no Shower.mp3" },
  { id: "going-my-way", name: "Going My Way", file: "/audio/Going My Way.mp3" },
  { id: "rakuen", name: "Rakuen", file: "/audio/Rakuen.mp3" },
  {
    id: "rising-weather-hallelujah",
    name: "Rising Weather Hallelujah",
    file: "/audio/Rising Weather Hallelujah.mp3",
  },
];

export const DEFAULT_TRACK_ID = "egyptian-1";

export const audioTrackGroups = [
  {
    label: "Defaults / Egyptian",
    match: (track) =>
      track.name.startsWith("Egyptian") ||
      track.name === "Desert Of Set" ||
      track.name === "Obelisk of Thunder",
  },
  {
    label: "Battle / Main Themes",
    match: (track) =>
      [
        "Millennium Battle 1",
        "Millennium Battle 2",
        "Millennium Battle 3",
        "Overlap",
        "Shuffle",
        "Wild Drive",
        "Warriors",
        "Voice",
        "EYES",
      ].includes(track.name),
  },
  {
    label: "Character / Lighter Tracks",
    match: (track) =>
      [
        "Ano hi no Gogo",
        "Afureru Kanjou ga Tomaranai",
        "Genki no Shower",
        "Going My Way",
        "Rakuen",
        "Rising Weather Hallelujah",
      ].includes(track.name),
  },
];

export default audioTracks;
