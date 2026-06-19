# Timelining Neo4j Docker image

Community Edition image used by propagate when provisioning Neo4j on Railway for timelining deployments.

Railway builds from this directory in the forked timelining repo (`rootDirectory: .docker`). Local parity:

```bash
docker build -t timelining-neo4j .
docker run -p 7687:7687 -e NEO4J_AUTH=neo4j/neo4jtesting timelining-neo4j
```

See also `test/test-env/docker-compose.yml` for local test setup.
