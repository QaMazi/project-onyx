export const audioTracks = [
  { id: "egyptian-1", name: "Project Onyx", file: "/audio/Egyptian 1.mp3" },
  { id: "egyptian-2", name: "Onyx 1", file: "/audio/Egyptian 2.mp3" },
  { id: "egyptian-3", name: "Onyx 2", file: "/audio/Egyptian 3.mp3" },
  { id: "egyptian-4", name: "Onyx 3", file: "/audio/Egyptian 4.mp3" },
  { id: "egyptian-5", name: "Onyx 4", file: "/audio/Egyptian 5.mp3" },
  { id: "egyptian-6", name: "Onyx 5", file: "/audio/Egyptian 6.mp3" },
  { id: "desert-of-set", name: "Onyx 6", file: "/audio/Desert Of Set.mp3" },
  { id: "obelisk-of-thunder", name: "Onyx 7", file: "/audio/Obelisk of Thunder.mp3" },
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
    label: "Project Onyx / Onyx",
    match: (track) =>
      track.id === DEFAULT_TRACK_ID ||
      track.name.startsWith("Onyx"),
  },
  {
    label: "Anime Tracks",
    match: (track) =>
      track.id !== DEFAULT_TRACK_ID && !track.name.startsWith("Onyx"),
  },
];

export default audioTracks;
