type token =
  | Empty
  | Comment
  | Events of string list
  | Header of string
  | File of string
  | Function of string
  | CalledFile of string
  | CalledFunction of string
  | Calls of int
  | Object
  | Cost of { line: int; costs: int list }

type function_node = {
  id: int;
  name: string;
  file: string;
  line: int;
}

type call_edge = {
  caller_id: int;
  callee_id: int;
  calls: int;
  inclusive: int;
  exclusive: int;
  inclusive_costs: int list;
}

type function_stats = {
  id: int;
  name: string;
  file: string;
  line: int;
  self_cost: int;
  total_cost: int;
  self_costs: int list;
  total_costs: int list;
  calls: int;
  callers: int list;
  callees: int list;
}

type profile_data = {
  functions: (int * function_node) list;
  edges: call_edge list;
  stats: (int * function_stats) list;
  total_cost: int;
  event_type: string;
  event_types: string list;
  total_costs: int list;
}
