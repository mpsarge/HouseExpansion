export type PopulationByState = Record<string, number>;

export type SeatAllocation = Record<string, number>;

export type PriorityEntry = {
  state: string;
  priority: number;
};

const compareEntries = (a: PriorityEntry, b: PriorityEntry) => {
  if (a.priority === b.priority) {
    return b.state.localeCompare(a.state);
  }
  return a.priority - b.priority;
};

class MaxHeap {
  private data: PriorityEntry[] = [];

  get size() {
    return this.data.length;
  }

  push(entry: PriorityEntry) {
    this.data.push(entry);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): PriorityEntry | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(index: number) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (compareEntries(this.data[current], this.data[parent]) <= 0) {
        return;
      }
      [this.data[current], this.data[parent]] = [
        this.data[parent],
        this.data[current],
      ];
      current = parent;
    }
  }

  private bubbleDown(index: number) {
    let current = index;
    const length = this.data.length;
    while (true) {
      const left = current * 2 + 1;
      const right = current * 2 + 2;
      let largest = current;

      if (left < length && compareEntries(this.data[left], this.data[largest]) > 0) {
        largest = left;
      }
      if (right < length && compareEntries(this.data[right], this.data[largest]) > 0) {
        largest = right;
      }
      if (largest === current) break;
      [this.data[current], this.data[largest]] = [
        this.data[largest],
        this.data[current],
      ];
      current = largest;
    }
  }
}

export const computePriority = (population: number, seats: number) =>
  population / Math.sqrt(seats * (seats + 1));

export const apportion = (
  populationsByState: PopulationByState,
  totalSeats: number
): SeatAllocation => {
  const states = Object.keys(populationsByState);
  const seats: SeatAllocation = {};
  states.forEach((state) => {
    seats[state] = 1;
  });

  const remaining = totalSeats - states.length;
  if (remaining < 0) {
    throw new Error("Total seats must be at least the number of states.");
  }

  const heap = new MaxHeap();
  states.forEach((state) => {
    const priority = computePriority(populationsByState[state], seats[state]);
    heap.push({ state, priority });
  });

  for (let i = 0; i < remaining; i += 1) {
    const entry = heap.pop();
    if (!entry) break;
    seats[entry.state] += 1;
    const nextPriority = computePriority(
      populationsByState[entry.state],
      seats[entry.state]
    );
    heap.push({ state: entry.state, priority: nextPriority });
  }

  return seats;
};
