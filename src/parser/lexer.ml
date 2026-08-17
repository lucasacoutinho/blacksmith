open Types

let header_keys =
  [ "version"; "creator"; "cmd"; "pid"; "thread"; "desc"; "event" ]

type compression_map = (int, string) Hashtbl.t

type state = {
  file_compression : compression_map;
  func_compression : compression_map;
  mutable positions : string list;
  mutable previous_positions : int64 option list;
}

let make_state () =
  {
    file_compression = Hashtbl.create 64;
    func_compression = Hashtbl.create 64;
    positions = [ "line" ];
    previous_positions = [ None ];
  }

let resolve_compressed value (map : compression_map) : string =
  let value = String.trim value in
  if String.length value > 0 && value.[0] = '(' then
    match String.index_opt value ')' with
    | None -> value
    | Some close_paren ->
        let id = String.sub value 1 (close_paren - 1) |> int_of_string_opt in
        begin match id with
        | None -> value
        | Some id ->
            let rest =
              String.sub value (close_paren + 1)
                (String.length value - close_paren - 1)
            in
            let name = String.trim rest in
            if String.length name > 0 then begin
              Hashtbl.replace map id name;
              name
            end
            else Option.value (Hashtbl.find_opt map id) ~default:value
        end
  else value

let is_space = function ' ' | '\t' -> true | _ -> false

let split_fields value =
  let length = String.length value in
  let rec skip_spaces index =
    if index < length && is_space value.[index] then skip_spaces (index + 1)
    else index
  in
  let rec find_end index =
    if index < length && not (is_space value.[index]) then find_end (index + 1)
    else index
  in
  let rec collect fields index =
    let start = skip_spaces index in
    if start >= length then List.rev fields
    else
      let finish = find_end start in
      collect (String.sub value start (finish - start) :: fields) finish
  in
  collect [] 0

let value_after separator line =
  match String.index_opt line separator with
  | Some index ->
      String.trim (String.sub line (index + 1) (String.length line - index - 1))
  | None -> ""

let line_prefix line =
  let separator =
    match (String.index_opt line '=', String.index_opt line ':') with
    | Some equals, Some colon -> min equals colon
    | Some equals, None -> equals
    | None, Some colon -> colon
    | None, None -> String.length line
  in
  String.sub line 0 separator

let reset_positions state positions =
  let positions = if positions = [] then [ "line" ] else positions in
  state.positions <- positions;
  state.previous_positions <- List.map (fun _ -> None) positions

let parse_subposition previous value =
  match value with
  | "*" -> previous
  | _ when String.length value > 1 && value.[0] = '+' ->
      Option.bind previous (fun base ->
          String.sub value 1 (String.length value - 1)
          |> Int64.of_string_opt
          |> Option.map (Int64.add base))
  | _ when String.length value > 1 && value.[0] = '-' ->
      Option.bind previous (fun base ->
          String.sub value 1 (String.length value - 1)
          |> Int64.of_string_opt
          |> Option.map (Int64.sub base))
  | _ -> Int64.of_string_opt value

let split_at count values =
  let rec split remaining prefix rest =
    if remaining = 0 then Some (List.rev prefix, rest)
    else
      match rest with
      | [] -> None
      | value :: tail -> split (remaining - 1) (value :: prefix) tail
  in
  split count [] values

let decode_positions state fields =
  let rec decode previous values decoded =
    match (previous, values) with
    | [], [] -> Some (List.rev decoded)
    | previous :: previous_tail, value :: value_tail -> begin
        match parse_subposition previous value with
        | Some decoded_value ->
            decode previous_tail value_tail (decoded_value :: decoded)
        | None -> None
      end
    | _ -> None
  in
  decode state.previous_positions fields []

let source_line state decoded_positions =
  let rec find positions values =
    match (positions, values) with
    | position :: _, value :: _ when position = "line" ->
        Option.value (int_of_string_opt (Int64.to_string value)) ~default:0
    | _ :: position_tail, _ :: value_tail -> find position_tail value_tail
    | _ -> 0
  in
  find state.positions decoded_positions

let parse_cost value = Counter.of_string value

let parse_costs values =
  let rec parse parsed = function
    | [] -> Some (List.rev parsed)
    | value :: rest -> begin
        match parse_cost value with
        | Some cost -> parse (cost :: parsed) rest
        | None -> None
      end
  in
  parse [] values

let parse_cost_line state line =
  let fields = split_fields line in
  match split_at (List.length state.positions) fields with
  | None -> Invalid
  | Some (position_fields, cost_fields) -> begin
      match
        (decode_positions state position_fields, parse_costs cost_fields)
      with
      | Some decoded_positions, Some costs ->
          state.previous_positions <-
            List.map (fun position -> Some position) decoded_positions;
          Cost { line = source_line state decoded_positions; costs }
      | _ -> Invalid
    end

let parse_calls state line =
  match split_fields (value_after '=' line) with
  | count_value :: position_values -> begin
      match
        ( parse_cost count_value,
          split_at (List.length state.positions) position_values )
      with
      | Some count, Some (position_fields, _) -> begin
          match decode_positions state position_fields with
          | Some decoded_positions ->
              Calls { count; target_line = source_line state decoded_positions }
          | None -> Invalid
        end
      | _ -> Invalid
    end
  | [] -> Invalid

let is_cost_start = function '0' .. '9' | '+' | '-' | '*' -> true | _ -> false

let lex_line state line : token =
  let line = String.trim line in
  if String.length line = 0 then Empty
  else if line.[0] = '#' then Comment
  else
    let prefix = line_prefix line in
    match prefix with
    | "events" ->
        state.previous_positions <- List.map (fun _ -> None) state.positions;
        let types = split_fields (value_after ':' line) in
        Events (if types = [] then [ "Time" ] else types)
    | "positions" ->
        let positions = split_fields (value_after ':' line) in
        reset_positions state positions;
        Positions state.positions
    | "part" ->
        reset_positions state [ "line" ];
        Part
    | "summary" -> begin
        match parse_costs (split_fields (value_after ':' line)) with
        | Some costs -> Summary costs
        | None -> Invalid
      end
    | "totals" -> begin
        match parse_costs (split_fields (value_after ':' line)) with
        | Some costs -> Totals costs
        | None -> Invalid
      end
    | prefix when List.mem prefix header_keys -> Header prefix
    | "fl" | "fi" | "fe" ->
        File (resolve_compressed (value_after '=' line) state.file_compression)
    | "fn" ->
        Function
          (resolve_compressed (value_after '=' line) state.func_compression)
    | "cfl" | "cfi" ->
        CalledFile
          (resolve_compressed (value_after '=' line) state.file_compression)
    | "cfn" ->
        CalledFunction
          (resolve_compressed (value_after '=' line) state.func_compression)
    | "calls" -> parse_calls state line
    | "ob" | "cob" -> Object
    | _ when is_cost_start line.[0] -> parse_cost_line state line
    | _ -> Invalid
