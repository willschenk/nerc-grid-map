// Minimal local type shim for the subset of d3-force the map uses (the project
// installs the other d3 @types but not @types/d3-force). Mirrors the upstream
// @types/d3-force API for forceSimulation / forceCollide / forceX / forceY.
declare module "d3-force" {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
  }

  export interface Force<NodeDatum extends SimulationNodeDatum, LinkDatum> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random: () => number): void;
  }

  type Accessor<NodeDatum, T> = (node: NodeDatum, i: number, nodes: NodeDatum[]) => T;

  export interface Simulation<NodeDatum extends SimulationNodeDatum, LinkDatum> {
    restart(): this;
    stop(): this;
    tick(iterations?: number): this;
    nodes(): NodeDatum[];
    nodes(nodes: NodeDatum[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(): number;
    alphaMin(min: number): this;
    alphaDecay(): number;
    alphaDecay(decay: number): this;
    alphaTarget(): number;
    alphaTarget(target: number): this;
    velocityDecay(): number;
    velocityDecay(decay: number): this;
    force<F extends Force<NodeDatum, LinkDatum>>(name: string): F | undefined;
    force(name: string, force: null | Force<NodeDatum, LinkDatum>): this;
    on(typenames: string, listener: ((this: this) => void) | null): this;
    on(typenames: string): ((this: this) => void) | undefined;
  }

  export function forceSimulation<NodeDatum extends SimulationNodeDatum>(
    nodes?: NodeDatum[],
  ): Simulation<NodeDatum, undefined>;

  export interface ForceCollide<NodeDatum extends SimulationNodeDatum>
    extends Force<NodeDatum, undefined> {
    radius(): Accessor<NodeDatum, number>;
    radius(radius: number | Accessor<NodeDatum, number>): this;
    strength(): number;
    strength(strength: number): this;
    iterations(): number;
    iterations(iterations: number): this;
  }
  export function forceCollide<NodeDatum extends SimulationNodeDatum>(
    radius?: number | Accessor<NodeDatum, number>,
  ): ForceCollide<NodeDatum>;

  export interface ForcePositional<NodeDatum extends SimulationNodeDatum>
    extends Force<NodeDatum, undefined> {
    strength(): Accessor<NodeDatum, number>;
    strength(strength: number | Accessor<NodeDatum, number>): this;
    x(x: number | Accessor<NodeDatum, number>): this;
    y(y: number | Accessor<NodeDatum, number>): this;
  }
  export function forceX<NodeDatum extends SimulationNodeDatum>(
    x?: number | Accessor<NodeDatum, number>,
  ): ForcePositional<NodeDatum>;
  export function forceY<NodeDatum extends SimulationNodeDatum>(
    y?: number | Accessor<NodeDatum, number>,
  ): ForcePositional<NodeDatum>;
}
