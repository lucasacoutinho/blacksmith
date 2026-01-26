open Types

let header_keys = ["version"; "creator"; "cmd"; "part"; "positions"; "summary"; "totals"; "pid"; "thread"; "desc"]

type compression_map = (int, string) Hashtbl.t

let resolve_compressed value (map : compression_map) : string =
  if String.length value > 0 && value.[0] = '(' then
    try
      let close_paren = String.index value ')' in
      let id = int_of_string (String.sub value 1 (close_paren - 1)) in
      let rest = String.sub value (close_paren + 1) (String.length value - close_paren - 1) in
      let name = String.trim rest in
      if String.length name > 0 then begin
        Hashtbl.replace map id name;
        name
      end else
        Hashtbl.find map id
    with _ -> value
  else value

let split_on_char c s =
  let rec aux acc i =
    try
      let j = String.index_from s i c in
      aux (String.sub s i (j - i) :: acc) (j + 1)
    with Not_found ->
      List.rev (String.sub s i (String.length s - i) :: acc)
  in
  aux [] 0

let lex_line line file_map func_map : token =
  let line = String.trim line in
  if String.length line = 0 then Empty
  else if line.[0] = '#' then Comment
  else
    let prefix =
      try
        let eq = String.index line '=' in
        let colon = try String.index line ':' with Not_found -> max_int in
        String.sub line 0 (min eq colon)
      with Not_found ->
        try String.sub line 0 (String.index line ':')
        with Not_found -> line
    in
    match prefix with
    | "events" ->
        let rest = String.sub line 7 (String.length line - 7) in
        let types = List.filter (fun s -> String.length s > 0) (split_on_char ' ' (String.trim rest)) in
        Events (if types = [] then ["Time"] else types)
    | p when List.mem p header_keys -> Header p
    | "fl" -> File (resolve_compressed (String.sub line 3 (String.length line - 3)) file_map)
    | "fi" | "fe" -> File (resolve_compressed (String.sub line 3 (String.length line - 3)) file_map)
    | "fn" -> Function (resolve_compressed (String.sub line 3 (String.length line - 3)) func_map)
    | "cfl" | "cfi" -> CalledFile (resolve_compressed (String.sub line 4 (String.length line - 4)) file_map)
    | "cfn" -> CalledFunction (resolve_compressed (String.sub line 4 (String.length line - 4)) func_map)
    | "calls" ->
        let rest = String.sub line 6 (String.length line - 6) in
        let parts = split_on_char ' ' (String.trim rest) in
        let count = try int_of_string (List.hd parts) with _ -> 1 in
        Calls count
    | "ob" | "cob" -> Object
    | _ ->
        if line.[0] >= '0' && line.[0] <= '9' then begin
          let parts = split_on_char ' ' line in
          match parts with
          | line_no :: costs ->
              let l = try int_of_string line_no with _ -> 0 in
              let c = List.map (fun s -> try int_of_string s with _ -> 0) costs in
              Cost { line = l; costs = c }
          | _ -> Empty
        end else Empty
