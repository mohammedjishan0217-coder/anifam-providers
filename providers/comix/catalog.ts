import { Catalog } from "../types";

export const catalog: Catalog[] = [
  {
    title: "Trending Comics",
    filter: "trending",
  },
  {
    title: "Most Popular",
    filter: "popular",
  },
  {
    title: "Hot Updates",
    filter: "hot",
  },
  {
    title: "New Releases",
    filter: "new",
  },
  {
    title: "Manhwa",
    filter: "type:manhwa",
  },
  {
    title: "Manga",
    filter: "type:manga",
  },
  {
    title: "Manhua",
    filter: "type:manhua",
  },
];

export const genres: Catalog[] = [
  { title: "Action", filter: "genre:action" },
  { title: "Adventure", filter: "genre:adventure" },
  { title: "Comedy", filter: "genre:comedy" },
  { title: "Drama", filter: "genre:drama" },
  { title: "Fantasy", filter: "genre:fantasy" },
  { title: "Horror", filter: "genre:horror" },
  { title: "Mystery", filter: "genre:mystery" },
  { title: "Romance", filter: "genre:romance" },
  { title: "Sci-Fi", filter: "genre:sci-fi" },
  { title: "Slice of Life", filter: "genre:slice-of-life" },
  { title: "Sports", filter: "genre:sports" },
  { title: "Supernatural", filter: "genre:supernatural" },
];
