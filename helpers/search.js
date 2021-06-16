export default class Search {
  #site = null;
  #cache = null;

  constructor(site) {
    this.#site = site;
    this.#cache = new Map();

    site.addEventListener("beforeUpdate", () => this.#cache.clear());
  }

  data(path = "/") {
    const file = this.#site.source.getFileOrDirectory(path);

    if (file) {
      return file.data;
    }
  }

  pages(query, sort, limit) {
    const result = this.#searchPages(query, sort);

    if (!limit) {
      return result;
    }

    return (limit < 0) ? result.slice(limit) : result.slice(0, limit);
  }

  tags(query) {
    const tags = new Set();

    this.pages(query).forEach((page) =>
      page.data.tags.forEach((tag) => tags.add(tag))
    );

    return Array.from(tags);
  }

  nextPage(url, query, sort) {
    const pages = this.pages(query, sort);
    const index = pages.findIndex((page) => page.data.url === url);

    return (index === -1) ? undefined : pages[index + 1];
  }

  previousPage(url, query, sort) {
    const pages = this.pages(query, sort);
    const index = pages.findIndex((page) => page.data.url === url);

    return (index <= 0) ? undefined : pages[index - 1];
  }

  #searchPages(query, sort = "date") {
    if (Array.isArray(query)) {
      query = query.join(" ");
    }

    const id = JSON.stringify([query, sort]);

    if (this.#cache.has(id)) {
      return [...this.#cache.get(id)];
    }

    const filter = buildFilter(query);
    const result = filter ? this.#site.pages.filter(filter) : this.#site.pages;

    result.sort(buildSort(sort));

    this.#cache.set(id, result);
    return [...result];
  }
}

export function buildFilter(query) {
  // ((fieldName)(operator))?(value|"value"|'value')
  const matches = query.matchAll(
    /(([\w.-]+)([!^$*]?=|[<>]=?))?([^'"\s][^\s=<>]+|"[^"]+"|'[^']+')/g,
  );
  const conditions = [["dest.ext", "=", ".html"]];

  for (const match of matches) {
    let [, , key, operator, value] = match;

    if (!key) {
      key = "tags";
      operator = "*=";
    }

    conditions.push([`data.${key}`, operator, compileValue(value)]);
  }

  return compileFilter(conditions);
}

function compileFilter(conditions) {
  const filters = [];
  const args = [];
  const values = [];

  conditions.forEach((condition, index) => {
    const [key, operator, value] = condition;
    const varName = `value${index}`;

    filters.push(compileCondition(key, operator, varName, value));
    args.push(varName);
    values.push(value);
  });

  args.push(`return (page) => ${filters.join(" && ")};`);

  const factory = new Function(...args);

  return factory(...values);
}

function compileCondition(key, operator, name, value) {
  key = key.replaceAll(".", "?.");

  if (value instanceof Date) {
    switch (operator) {
      case "=":
        return `page.${key}?.getTime() === ${name}.getTime()`;

      case "!=":
        return `page.${key}?.getTime() !== ${name}.getTime()`;

      case "<":
      case "<=":
      case ">":
      case ">=":
        return `page.${key}?.getTime() ${operator} ${name}.getTime()`;

      default:
        throw new Error(`Operator ${operator} not valid for Date values`);
    }
  }

  if (Array.isArray(value)) {
    switch (operator) {
      case "=":
        return `${name}.some((i) => page.${key} === i)`;

      case "!=":
        return `${name}.some((i) => page.${key} !== i)`;

      case "^=":
        return `${name}.some((i) => page.${key}?.startsWith(i))`;

      case "$=":
        return `${name}.some((i) => page.${key}?.endsWith(i))`;

      case "*=":
        return `${name}.some((i) => page.${key}?.includes(i))`;

      default: // < <= > >=
        return `${name}.some((i) => page.${key} ${operator} i)`;
    }
  }

  switch (operator) {
    case "=":
      return `page.${key} === ${name}`;

    case "!=":
      return `page.${key} !== ${name}`;

    case "^=":
      return `page.${key}?.startsWith(${name})`;

    case "$=":
      return `page.${key}?.endsWith(${name})`;

    case "*=":
      return `page.${key}?.includes(${name})`;

    default: // < <= > >=
      return `page.${key} ${operator} ${name}`;
  }
}

function compileValue(value) {
  if (!value) {
    return value;
  }

  // Remove quotes
  value = value.replace(/^(['"])(.*)\1$/, "$2");

  if (value.includes("|")) {
    return value.split("|").map((val) => compileValue(val));
  }
  if (value.toLowerCase() === "true") {
    return true;
  }
  if (value.toLowerCase() === "false") {
    return false;
  }
  if (isFinite(value)) {
    return Number(value);
  }
  // Date or datetime values:
  // yyyy-mm
  // yyyy-mm-dd
  // yyyy-mm-ddThh
  // yyyy-mm-ddThh:ii
  // yyyy-mm-ddThh:ii:ss
  const match = value.match(
    /^(\d{4})-(\d\d)(?:-(\d\d))?(?:T(\d\d)(?::(\d\d))?(?::(\d\d))?)?$/i,
  );

  if (match) {
    const [, year, month, day, hour, minute, second] = match;

    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      day ? parseInt(day) : 1,
      hour ? parseInt(hour) : 0,
      minute ? parseInt(minute) : 0,
      second ? parseInt(second) : 0,
    );
  }

  return value;
}

export function buildSort(sort) {
  let fn = "0";

  if (typeof sort === "string") {
    sort = sort.split(/\s+/).filter((arg) => arg);
  }

  sort.reverse().forEach((arg) => {
    const match = arg.match(/([\w.-]+)(?:=(asc|desc))?/);

    if (!match) {
      return;
    }

    let [, key, direction] = match;
    key = key.replaceAll(".", "?.");
    const operator = direction === "desc" ? ">" : "<";
    fn =
      `(a.data?.${key} == b.data?.${key} ? ${fn} : (a.data?.${key} ${operator} b.data?.${key} ? -1 : 1))`;
  });

  return new Function("a", "b", `return ${fn}`);
}
