import { Catalog } from "../types";

export const catalog: Catalog[] = [
  {
    title: "Popular Anime",
    filter: "popular",
  },
  {
    title: "Newly Added",
    filter: "newly_added",
  },
  {
    title: "Top Airing",
    filter: "top_airing",
  },
  {
    title: "Alphabetical",
    filter: "alphabetical",
  },
];

export const genres: Catalog[] = [
  { title: "Action", filter: "genre:action" },
  { title: "Adventure", filter: "genre:adventure" },
  { title: "Comedy", filter: "genre:comedy" },
  { title: "Drama", filter: "genre:drama" },
  { title: "Fantasy", filter: "genre:fantasy" },
  { title: "Music", filter: "genre:music" },
  { title: "Romance", filter: "genre:romance" },
  { title: "Sci-Fi", filter: "genre:sci-fi" },
  { title: "Seinen", filter: "genre:seinen" },
  { title: "Shojo", filter: "genre:shojo" },
  { title: "Shonen", filter: "genre:shonen" },
  { title: "Slice of Life", filter: "genre:slice_of_life" },
  { title: "Sports", filter: "genre:sports" },
  { title: "Supernatural", filter: "genre:supernatural" },
  { title: "Thriller", filter: "genre:thriller" },
];
