type cost = Counter.t

type token =
  | Empty
  | Comment
  | Invalid
  | Events of string list
  | Positions of string list
  | Part
  | Summary of cost list
  | Totals of cost list
  | Header of string
  | File of string
  | Function of string
  | CalledFile of string
  | CalledFunction of string
  | Calls of { count : cost; target_line : int }
  | Object
  | Cost of { line : int; costs : cost list }

type function_node = { id : int; name : string; file : string; line : int }

type call_edge = {
  caller_id : int;
  callee_id : int;
  calls : cost;
  callsite_line : int;
  inclusive : cost;
  exclusive : cost;
  inclusive_costs : cost list;
}

type function_stats = {
  id : int;
  name : string;
  file : string;
  line : int;
  self_cost : cost;
  total_cost : cost;
  self_costs : cost list;
  total_costs : cost list;
  line_costs : (int * cost list) list;
  calls : cost;
  callers : int list;
  callees : int list;
}

type profile_data = {
  functions : (int * function_node) list;
  edges : call_edge list;
  stats : (int * function_stats) list;
  total_cost : cost;
  event_type : string;
  event_types : string list;
  total_costs : cost list;
}
