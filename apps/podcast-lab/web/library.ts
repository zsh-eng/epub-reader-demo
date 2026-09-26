import {
  arrive,
  cancelNavigationMotion,
  captureArtwork,
  carryArtwork,
  type ArtworkOrigin,
} from "./motion";
import { getJSON } from "./cache";
export type Show = {
  id: string;
  title: string;
  creator: string;
  description: string;
  feed: string;
  artwork: string;
  cached?: boolean;
};
export type FeedEpisode = {
  id: string;
  showId: string;
  title: string;
  description: string;
  published: string;
  duration: number;
  audioURL: string;
  source: string;
  preparedId: string | null;
};
type Library = { shows: Show[]; episodes: FeedEpisode[] };
type Open = (
  episode: FeedEpisode,
  show: Show,
  autoplay?: boolean,
  origin?: ArtworkOrigin,
) => Promise<void>;
const el = (id: string) => document.getElementById(id)!;
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
) => {
  const n = document.createElement(tag);
  n.className = className;
  n.textContent = text;
  return n;
};
const icon = (name: string) =>
  ({ home: "◉", following: "♡", downloads: "↓", shows: "▦" })[name] ?? "";
const date = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

/** Library navigation never owns/recreates the audio element. Page through a
 * bounded number of RSS rows; do not mount a complete feed archive at once. */
export async function initLibrary(open: Open) {
  let data: Library;
  try {
    data = await getJSON<Library>("/library.json");
    const ready: string[] = await fetch("/api/preparations")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    const prepared = new Set(ready);
    for (const episode of data.episodes)
      if (prepared.has(episode.id)) episode.preparedId = episode.id;
  } catch {
    el("library-content").textContent =
      "Library unavailable. Reload to try again.";
    return;
  }
  const savedFollows = stored<unknown>(
    "undertone:follows",
    data.shows.map((show) => show.id),
  );
  const follows = new Set<string>(
    Array.isArray(savedFollows)
      ? savedFollows.filter(
          (id): id is string =>
            typeof id === "string" && data.shows.some((show) => show.id === id),
        )
      : [],
  );
  let page = 0,
    search = "",
    current =
      data.episodes.find((e) => e.id === stored("undertone:current", "")) ??
      data.episodes.find((e) => e.preparedId === "ezra") ??
      data.episodes[0];
  let loadVersion = 0;
  let playWhenReady = false;
  let origin: ArtworkOrigin | undefined;
  const showsById = new Map(data.shows.map((show) => [show.id, show]));
  const showFor = (id: string) => showsById.get(id)!;
  const searchText = new Map(
    data.episodes.map((episode) => [
      episode.id,
      [
        episode.title,
        episode.description,
        showFor(episode.showId).title,
        showFor(episode.showId).creator,
      ]
        .join(" ")
        .toLocaleLowerCase(),
    ]),
  );
  const cover = (show: Show, size: number) => {
    const image = node("img", "show-cover");
    image.src = show.artwork;
    image.alt = "";
    image.width = size;
    image.height = size;
    image.loading = "lazy";
    image.decoding = "async";
    return image;
  };
  const button = (
    label: string,
    action: () => void,
    className = "library-button",
  ) => {
    const b = node("button", className, label);
    b.addEventListener("click", action);
    return b;
  };
  const goto = (route: string) => {
    location.hash = route;
  };
  const follow = (show: Show) => {
    const b = button(follows.has(show.id) ? "Following" : "Follow", () => {
      if (follows.has(show.id)) follows.delete(show.id);
      else follows.add(show.id);
      try {
        localStorage.setItem("undertone:follows", JSON.stringify([...follows]));
      } catch {
        /* Browsing remains available. */
      }
      render();
      renderNav();
    });
    b.setAttribute("aria-pressed", String(follows.has(show.id)));
    b.setAttribute(
      "aria-label",
      `${follows.has(show.id) ? "Unfollow" : "Follow"} ${show.title}`,
    );
    return b;
  };
  function renderNav() {
    const nav = el("library-nav");
    nav.replaceChildren();
    for (const [key, label] of [
      ["home", "Home"],
      ["following", "Following"],
      ["downloads", "Downloads"],
      ["shows", "All shows"],
    ]) {
      const link = node("a", "library-nav-link");
      link.href = `#${key}`;
      const mark = node("span", "nav-symbol", icon(key));
      mark.setAttribute("aria-hidden", "true");
      link.append(mark, node("span", "", label));
      if ((location.hash.slice(1) || "home") === key)
        link.setAttribute("aria-current", "page");
      nav.append(link);
    }
    const heading = node("p", "nav-heading", "Following");
    nav.append(heading);
    for (const show of data.shows.filter((s) => follows.has(s.id))) {
      const a = node("a", "library-nav-link show-nav");
      a.href = `#show/${show.id}`;
      a.append(cover(show, 28), node("span", "", show.title));
      nav.append(a);
    }
    if (!follows.size)
      nav.append(node("p", "nav-hint", "Your shows will live here."));
  }
  function showCard(show: Show) {
    const card = node("article", "show-card");
    const a = node("a", "show-card-link");
    a.href = `#show/${show.id}`;
    a.append(
      cover(show, 180),
      node("h3", "", show.title),
      node("p", "muted", show.creator),
    );
    card.append(a, follow(show));
    return card;
  }
  async function listen(episode: FeedEpisode) {
    const version = ++loadVersion;
    const autoplay = playWhenReady;
    playWhenReady = false;
    el("library-status").textContent = "";
    const source = origin;
    origin = undefined;
    try {
      await open(episode, showFor(episode.showId), autoplay, source);
      if (version !== loadVersion) return;
      current = episode;
      try {
        localStorage.setItem("undertone:current", JSON.stringify(episode.id));
      } catch {
        /* Playback does not depend on storage. */
      }
    } catch {
      if (version !== loadVersion) return;
      el("library-status").textContent =
        "Could not open this episode. Select it again to retry.";
    }
  }
  function episodeRow(episode: FeedEpisode) {
    const show = showFor(episode.showId),
      row = node("article", "episode-row");
    const imageLink = node("a", "episode-cover-link");
    imageLink.href = `#show/${show.id}`;
    imageLink.setAttribute("aria-label", show.title);
    imageLink.append(cover(show, 76));
    const text = node("div", "episode-copy");
    const info = node("p", "episode-meta");
    const showLink = node("a", "", show.title);
    showLink.href = `#show/${show.id}`;
    info.append(
      showLink,
      document.createTextNode(` · ${date(episode.published)}`),
    );
    const title = node("a", "episode-title", episode.title);
    title.href = `#listen/${episode.id}`;
    const description = node("p", "episode-description", episode.description);
    const detail = node(
      "span",
      "episode-detail",
      `${Math.round(episode.duration / 60)} min · ${episode.preparedId ? "Downloaded · Transcript" : "Stream"}`,
    );
    text.append(info, title, description, detail);
    const play = button(
      "▶",
      () => {
        playWhenReady = true;
        if (location.hash === `#listen/${episode.id}`) void listen(episode);
        else goto(`listen/${episode.id}`);
      },
      "episode-play",
    );
    play.setAttribute("aria-label", `Play ${episode.title}`);
    row.append(imageLink, text, play);
    return row;
  }
  function render() {
    const route = location.hash.slice(1) || "home";
    if (route === "player" || route.startsWith("listen/")) return;
    const content = el("library-content");
    content.replaceChildren();
    const selected = route.startsWith("show/")
      ? data.shows.find((s) => s.id === route.slice(5))
      : undefined;
    const titles: Record<string, string> = {
      home: "Good listening.",
      following: "Following",
      downloads: "Downloads",
      shows: "Your shows.",
    };
    el("library-title").textContent =
      selected?.title ?? titles[route] ?? titles.home;
    let episodes = data.episodes;
    if (selected) {
      const hero = node("section", "show-hero");
      const copy = node("div", "");
      copy.append(
        node("p", "eyebrow", selected.creator),
        node("p", "show-description", selected.description),
        follow(selected),
      );
      const rss = node("a", "rss-link", "RSS feed ↗");
      rss.href = selected.feed;
      rss.target = "_blank";
      rss.rel = "noreferrer";
      copy.append(rss);
      hero.append(cover(selected, 170), copy);
      content.append(hero);
      episodes = episodes.filter((e) => e.showId === selected.id);
    } else if (route === "following")
      episodes = episodes.filter((e) => follows.has(e.showId));
    else if (route === "downloads")
      episodes = episodes.filter((e) => e.preparedId);
    if (!search && (route === "home" || route === "shows")) {
      if (route === "home" && current) {
        const feature = node("section", "continue-card"),
          show = showFor(current.showId),
          copy = node("div", "continue-copy");
        copy.append(
          node("p", "eyebrow", "On your turntable"),
          node("h2", "", current.title),
          node("p", "muted", show.title),
          button("Open episode  ↗", () => goto(`listen/${current.id}`)),
        );
        feature.append(copy, cover(show, 144));
        content.append(feature);
      }
      const section = node("section", "show-section");
      section.append(node("h2", "section-heading", "Your shows"));
      const grid = node(
        "div",
        route === "home" ? "show-grid home-show-shelf" : "show-grid",
      );
      for (const show of data.shows) grid.append(showCard(show));
      section.append(grid);
      content.append(section);
      if (route === "shows") return;
    }
    if (search) {
      const q = search.toLocaleLowerCase();
      episodes = episodes.filter((e) => searchText.get(e.id)!.includes(q));
    }
    const heading = node("div", "feed-heading");
    heading.append(
      node(
        "h2",
        "section-heading",
        search
          ? "Results"
          : selected
            ? "Episodes"
            : route === "downloads"
              ? "Ready offline"
              : "Latest episodes",
      ),
      node("span", "muted", String(episodes.length)),
    );
    content.append(heading);
    if (!episodes.length) {
      const empty = node("div", "library-empty");
      empty.append(
        node("span", "empty-wave", "∿"),
        node(
          "h3",
          "",
          search ? "Nothing on this frequency." : "A little quiet here.",
        ),
        node(
          "p",
          "muted",
          search
            ? "Try a show, creator or episode title."
            : "Follow a show to bring its episodes here.",
        ),
      );
      content.append(empty);
      return;
    }
    const pages = Math.ceil(episodes.length / 20);
    page = Math.min(page, pages - 1);
    const list = node("section", "episode-list");
    list.setAttribute("aria-label", "Episodes");
    for (const episode of episodes.slice(page * 20, page * 20 + 20))
      list.append(episodeRow(episode));
    content.append(list);
    if (pages > 1) {
      const pager = node("nav", "feed-pagination");
      pager.setAttribute("aria-label", "Feed pages");
      const change = (delta: number) => {
        page += delta;
        render();
        el("library-main").scrollTo({ top: 0, behavior: "instant" });
      };
      const previous = button("← Previous", () => change(-1)),
        next = button("Next →", () => change(1));
      previous.disabled = page === 0;
      next.disabled = page === pages - 1;
      pager.append(
        previous,
        node("span", "muted", `${page + 1} / ${pages}`),
        next,
      );
      content.append(pager);
    }
  }
  function route() {
    cancelNavigationMotion();
    const hash = location.hash.slice(1) || "home",
      player = hash === "player" || hash.startsWith("listen/");
    document.body.classList.toggle("library-open", !player);
    el("library-shell").hidden = player;
    el("reader-workspace").hidden = !player;
    if (player) {
      if (hash.startsWith("listen/")) {
        const episode = data.episodes.find((e) => e.id === hash.slice(7));
        if (episode) void listen(episode);
        else {
          el("library-status").textContent = "Episode not found.";
          goto("home");
        }
      }
      return;
    }
    page = 0;
    render();
    renderNav();
    // Other selected episodes can finish while this one plays. Refresh the
    // small ready index on library navigation, without refetching RSS metadata.
    void fetch("/api/preparations")
      .then((response) => (response.ok ? response.json() : []))
      .then((ready: string[]) => {
        const ids = new Set(ready);
        let changed = false;
        for (const episode of data.episodes) {
          if (!episode.preparedId && ids.has(episode.id)) {
            episode.preparedId = episode.id;
            changed = true;
          }
        }
        if (changed && !el("library-shell").hidden) render();
      })
      .catch(() => {
        /* Offline browsing keeps its last known local state. */
      });
    if (origin && hash.startsWith("show/"))
      carryArtwork(
        origin,
        el("library-content").querySelector<HTMLImageElement>(".show-hero img"),
      );
    origin = undefined;
    arrive(el("library-content"));
  }
  // Capture geometry before the route hides/removes its source. Purely visual:
  // playback state and selection do not wait for an animation.
  el("library-shell").addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          ".episode-title, .episode-play, .continue-card button, .show-card-link, .episode-cover-link, .show-nav",
        )
      )
        origin = captureArtwork(
          target.closest(".episode-row, .continue-card, .show-card, .show-nav"),
        );
      else origin = undefined;
    },
    true,
  );
  const searchInput = el("library-search") as HTMLInputElement;
  searchInput.addEventListener("input", () => {
    search = searchInput.value.trim();
    page = 0;
    render();
  });
  el("now-playing").addEventListener("click", () => goto("player"));
  window.addEventListener("hashchange", route);
  window.addEventListener("undertone-prepared", () => {
    if (!el("library-shell").hidden) render();
  });
  // Prepare the first local episode while keeping Home visible. A direct episode
  // URL takes priority and does not start a competing default load.
  if (!location.hash.startsWith("#listen/") && current) void listen(current);
  route();
  if (!el("library-shell").hidden) arrive(el("library-content"), true);
}
